'use client';

// React modules
import { useEffect, useRef, useCallback, useMemo } from 'react';

// Node modules
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// GA-evolved morph target samples (fallback when backend doesn't provide them)
import gaSamples from '../../../../hologram_samples.json';

// Styles
import classes from './HologramViewer.module.scss';

// ── Types ──────────────────────────────────────────────

type JointDef = {
  id: string;
  position: [number, number, number];
  parent_id: string | null;
};

type PointDef = {
  joint_id: string;
  offset: [number, number, number];
  color: string;
  size: number;
};

type PoseJoint = {
  rx: number;
  ry: number;
  rz: number;
};

type PoseData = {
  joints: Record<string, PoseJoint>;
};

type PointMorph = {
  joint_id: string;
  offset_delta: [number, number, number];
  size_scale: number;
};

type MorphTargetEntry = {
  emotion: string;
  pose: PoseData;
  point_morphs: PointMorph[];
  fitness: number;
};

type AvatarData = {
  id: string;
  userId: string;
  label: string;
  skeleton: JointDef[];
  points: PointDef[];
  pose: PoseData | null;
  physics: boolean;
  morphTargets?: Record<string, MorphTargetEntry[]>;
  activeMorph?: string; // Current emotion morph being applied
  morphWeight?: number; // 0..1 blend weight
};

type HologramViewerProps = {
  avatars: AvatarData[];
};

// ── Constants ──────────────────────────────────────────

const HOLOGRAM_COLOR = 0x63c5c0;
const BONE_COLOR = 0x2a7a76;
const GRID_COLOR = 0x1a3a38;
const MAX_POINT_INSTANCES = 256;
const IK_ITERATIONS = 5;
const IK_DAMPING = 0.85;
const MORPH_LERP_SPEED = 4.0; // Weight units per second for smooth transitions

// Emotion → index mapping for morphTargetInfluences-style array
const EMOTIONS = ['happy', 'sad', 'angry', 'neutral'] as const;
type Emotion = (typeof EMOTIONS)[number];
const EMOTION_INDEX: Record<string, number> = { happy: 0, sad: 1, angry: 2, neutral: 3 };

// Pre-extract top-1 GA morph per emotion as fallback data
const GA_MORPH_TARGETS: Record<string, MorphTargetEntry[]> = gaSamples.morphTargets as unknown as Record<
  string,
  MorphTargetEntry[]
>;

// Per-avatar morph interpolation state (lives outside React state for animation loop access)
type MorphState = {
  targetEmotion: string;
  targetWeight: number;
  currentWeight: number; // Lerped toward targetWeight each frame
  currentInfluences: Float32Array; // [happy, sad, angry, neutral] — lerped per frame
  targetInfluences: Float32Array;
  dirty: boolean; // Needs geometry rebuild this frame
};

// ── Custom Glow Shader ────────────────────────────────

const hologramGlowVertexShader = `
  attribute float instanceScale;
  attribute vec3 instanceColor;
  attribute float instanceGlow;

  varying vec3 vColor;
  varying float vGlow;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vColor = instanceColor;
    vGlow = instanceGlow;
    vNormal = normalMatrix * normal;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position * instanceScale, 1.0);
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const hologramGlowFragmentShader = `
  varying vec3 vColor;
  varying float vGlow;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    // Fresnel rim glow
    vec3 viewDir = normalize(vViewPosition);
    float rim = 1.0 - max(dot(viewDir, normalize(vNormal)), 0.0);
    rim = pow(rim, 2.0);

    // Core color + rim glow
    vec3 coreColor = vColor * (0.6 + 0.4 * vGlow);
    vec3 rimColor = vColor * rim * vGlow * 1.5;
    vec3 finalColor = coreColor + rimColor;

    // Hologram scanline effect
    float scanline = sin(gl_FragCoord.y * 0.8) * 0.05 * vGlow;
    finalColor += vec3(scanline);

    float alpha = 0.75 + rim * 0.25 * vGlow;
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ── Momentum IK Solver (Cannon-es based) ──────────────

type IKChain = {
  jointIds: string[];
  bodies: CANNON.Body[];
  constraints: CANNON.DistanceConstraint[];
};

const buildIKChain = (
  world: CANNON.World,
  skeleton: JointDef[],
  jointPositions: Map<string, THREE.Vector3>,
  chainJointIds: string[],
): IKChain => {
  const bodies: CANNON.Body[] = [];
  const constraints: CANNON.DistanceConstraint[] = [];

  for (let i = 0; i < chainJointIds.length; i++) {
    const jointId = chainJointIds[i];
    const pos = jointPositions.get(jointId);
    if (!pos) continue;

    const isRoot = i === 0;
    const body = new CANNON.Body({
      mass: isRoot ? 0 : 0.5, // Root is fixed
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      shape: new CANNON.Sphere(0.02),
      linearDamping: IK_DAMPING,
      angularDamping: IK_DAMPING,
    });
    world.addBody(body);
    bodies.push(body);

    // Distance constraint to previous joint
    if (i > 0) {
      const prevJoint = skeleton.find((j) => j.id === chainJointIds[i]);
      if (prevJoint) {
        const boneLength = Math.sqrt(
          prevJoint.position[0] ** 2 + prevJoint.position[1] ** 2 + prevJoint.position[2] ** 2,
        );
        const constraint = new CANNON.DistanceConstraint(bodies[i - 1], body, boneLength, 1e4);
        world.addConstraint(constraint);
        constraints.push(constraint);
      }
    }
  }

  return { jointIds: chainJointIds, bodies, constraints };
};

const solveIK = (chain: IKChain, targetPos: THREE.Vector3, world: CANNON.World): Map<string, THREE.Vector3> => {
  const results = new Map<string, THREE.Vector3>();

  // Apply target force to end effector
  const endBody = chain.bodies[chain.bodies.length - 1];
  if (endBody) {
    const target = new CANNON.Vec3(targetPos.x, targetPos.y, targetPos.z);
    const diff = target.vsub(endBody.position);
    endBody.applyForce(diff.scale(50));
  }

  // Step physics
  for (let i = 0; i < IK_ITERATIONS; i++) {
    world.step(1 / 120);
  }

  // Read back positions
  for (let i = 0; i < chain.jointIds.length; i++) {
    const body = chain.bodies[i];
    results.set(chain.jointIds[i], new THREE.Vector3(body.position.x, body.position.y, body.position.z));
  }

  return results;
};

const cleanupIKChain = (chain: IKChain, world: CANNON.World): void => {
  for (const constraint of chain.constraints) {
    world.removeConstraint(constraint);
  }
  for (const body of chain.bodies) {
    world.removeBody(body);
  }
};

// ── Helper: get effective morph targets (avatar-provided or GA fallback) ──

const getEffectiveMorphTargets = (avatar: AvatarData): Record<string, MorphTargetEntry[]> =>
  avatar.morphTargets && Object.keys(avatar.morphTargets).length > 0 ? avatar.morphTargets : GA_MORPH_TARGETS;

// ── Helper: blend multiple emotions via influences array ──

const blendPoseMulti = (
  basePose: PoseData | null,
  morphTargets: Record<string, MorphTargetEntry[]>,
  influences: Float32Array,
): PoseData | null => {
  // Sum of all influences — if zero, return base
  let totalWeight = 0;
  for (let i = 0; i < EMOTIONS.length; i++) totalWeight += influences[i];
  if (totalWeight <= 0.001) return basePose;

  const baseJoints = basePose?.joints || {};
  const blended: Record<string, PoseJoint> = {};

  // Collect all joint IDs across base + all active morphs
  const allKeys = new Set(Object.keys(baseJoints));
  for (let i = 0; i < EMOTIONS.length; i++) {
    if (influences[i] <= 0) continue;
    const morph = morphTargets[EMOTIONS[i]]?.[0];
    if (morph) {
      for (const k of Object.keys(morph.pose.joints)) allKeys.add(k);
    }
  }

  for (const key of allKeys) {
    const base = baseJoints[key] || { rx: 0, ry: 0, rz: 0 };
    let rx = base.rx,
      ry = base.ry,
      rz = base.rz;

    for (let i = 0; i < EMOTIONS.length; i++) {
      const w = influences[i];
      if (w <= 0) continue;
      const morph = morphTargets[EMOTIONS[i]]?.[0];
      if (!morph) continue;
      const mj = morph.pose.joints[key];
      if (!mj) continue;
      rx += (mj.rx - base.rx) * w;
      ry += (mj.ry - base.ry) * w;
      rz += (mj.rz - base.rz) * w;
    }

    blended[key] = { rx, ry, rz };
  }

  return { joints: blended };
};

// ── Component ──────────────────────────────────────────

const HologramViewer: React.FC<HologramViewerProps> = ({ avatars }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const worldRef = useRef<CANNON.World | null>(null);
  const frameRef = useRef<number>(0);
  const avatarGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const instancedMeshRef = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const ikChainsRef = useRef<Map<string, IKChain[]>>(new Map());
  const jointMarkersRef = useRef<Map<string, Map<string, THREE.Mesh>>>(new Map());
  const boneGeometriesRef = useRef<Map<string, THREE.BufferGeometry[]>>(new Map());
  const morphStateRef = useRef<Map<string, MorphState>>(new Map());
  const avatarsRef = useRef<AvatarData[]>(avatars);
  avatarsRef.current = avatars;

  // Shared instanced sphere geometry for all point rendering
  const sharedSphereGeo = useMemo(() => new THREE.SphereGeometry(0.02, 10, 8), []);

  // Custom shader material for holographic glow
  const glowMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: hologramGlowVertexShader,
        fragmentShader: hologramGlowFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Resolve joint positions from skeleton + pose
  const resolveJointPositions = useCallback(
    (skeleton: JointDef[], pose: PoseData | null): Map<string, THREE.Vector3> => {
      const jointPositions = new Map<string, THREE.Vector3>();

      for (const joint of skeleton) {
        const base = new THREE.Vector3(...joint.position);
        if (joint.parent_id && jointPositions.has(joint.parent_id)) {
          base.add(jointPositions.get(joint.parent_id)!);
        }
        jointPositions.set(joint.id, base);
      }

      if (pose?.joints) {
        const orderedJoints = [...skeleton];
        for (const joint of orderedJoints) {
          const poseJoint = pose.joints[joint.id];
          if (!poseJoint || !joint.parent_id) continue;

          const pos = jointPositions.get(joint.id);
          const parentPos = jointPositions.get(joint.parent_id);
          if (!pos || !parentPos) continue;

          const offset = pos.clone().sub(parentPos);
          const euler = new THREE.Euler(poseJoint.rx, poseJoint.ry, poseJoint.rz);
          offset.applyEuler(euler);
          jointPositions.set(joint.id, parentPos.clone().add(offset));

          for (const child of orderedJoints) {
            if (child.parent_id === joint.id) {
              const childPos = jointPositions.get(child.id);
              if (childPos) {
                const childOffset = childPos.clone().sub(pos);
                childOffset.applyEuler(euler);
                jointPositions.set(child.id, jointPositions.get(joint.id)!.clone().add(childOffset));
              }
            }
          }
        }
      }

      return jointPositions;
    },
    [],
  );

  // Update bone line + instanced point geometry for an avatar at current morph state
  const updateAvatarGeometry = useCallback(
    (avatar: AvatarData, morphState: MorphState) => {
      const morphTargets = getEffectiveMorphTargets(avatar);
      const effectivePose = blendPoseMulti(avatar.pose, morphTargets, morphState.currentInfluences);
      const jointPositions = resolveJointPositions(avatar.skeleton, effectivePose);

      // ── Update bone lines ─────────────────────────────
      const boneGeos = boneGeometriesRef.current.get(avatar.id);
      if (boneGeos) {
        let bIdx = 0;
        for (const joint of avatar.skeleton) {
          if (!joint.parent_id) continue;
          const start = jointPositions.get(joint.parent_id);
          const end = jointPositions.get(joint.id);
          if (!start || !end || bIdx >= boneGeos.length) { bIdx++; continue; }
          const posArr = boneGeos[bIdx].getAttribute('position') as THREE.BufferAttribute;
          posArr.setXYZ(0, start.x, start.y, start.z);
          posArr.setXYZ(1, end.x, end.y, end.z);
          posArr.needsUpdate = true;
          bIdx++;
        }
      }

      // ── Update instanced point mesh ───────────────────
      const instMesh = instancedMeshRef.current.get(avatar.id);
      if (instMesh && avatar.points.length > 0) {
        const dummy = new THREE.Matrix4();
        const scaleAttr = instMesh.geometry.getAttribute('instanceScale') as THREE.InstancedBufferAttribute;

        for (let i = 0; i < avatar.points.length; i++) {
          const point = avatar.points[i];
          const jointPos = jointPositions.get(point.joint_id);
          if (!jointPos) continue;

          let offset = new THREE.Vector3(...point.offset);
          let sizeScale = 1.0;

          // Multi-emotion point morph blending
          for (let ei = 0; ei < EMOTIONS.length; ei++) {
            const w = morphState.currentInfluences[ei];
            if (w <= 0) continue;
            const morph = morphTargets[EMOTIONS[ei]]?.[0];
            if (!morph?.point_morphs) continue;
            const pm = morph.point_morphs.find((m) => m.joint_id === point.joint_id);
            if (pm) {
              offset.add(new THREE.Vector3(...pm.offset_delta).multiplyScalar(w));
              sizeScale += (pm.size_scale - 1) * w;
            }
          }

          const worldPos = jointPos.clone().add(offset);
          const pointSize = point.size * 0.02 * sizeScale;

          // Core point
          dummy.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
          instMesh.setMatrixAt(i * 2, dummy);
          scaleAttr.setX(i * 2, pointSize / 0.02);

          // Glow sphere
          instMesh.setMatrixAt(i * 2 + 1, dummy);
          scaleAttr.setX(i * 2 + 1, (pointSize * 1.75) / 0.02);
        }

        scaleAttr.needsUpdate = true;
        instMesh.instanceMatrix.needsUpdate = true;
      }

      // ── Update joint markers ──────────────────────────
      const markers = jointMarkersRef.current.get(avatar.id);
      if (markers) {
        for (const [jointId, pos] of jointPositions) {
          const marker = markers.get(jointId);
          if (marker) marker.position.copy(pos);
        }
      }
    },
    [resolveJointPositions],
  );

  // Build avatar group (structural: bones, points, markers — morph state applied via animation loop)
  const buildAvatarGroup = useCallback(
    (avatar: AvatarData): THREE.Group => {
      const group = new THREE.Group();
      group.name = avatar.id;

      // Get current morph state for initial geometry
      const mState = morphStateRef.current.get(avatar.id);
      const morphTargets = getEffectiveMorphTargets(avatar);
      const influences = mState?.currentInfluences ?? new Float32Array(EMOTIONS.length);
      const effectivePose = blendPoseMulti(avatar.pose, morphTargets, influences);
      const jointPositions = resolveJointPositions(avatar.skeleton, effectivePose);

      // ── Bones (Lines) ───────────────────────────────
      const boneMaterial = new THREE.LineBasicMaterial({
        color: BONE_COLOR,
        linewidth: 2,
        transparent: true,
        opacity: 0.6,
      });

      const boneGeos: THREE.BufferGeometry[] = [];
      for (const joint of avatar.skeleton) {
        if (!joint.parent_id) continue;
        const start = jointPositions.get(joint.parent_id);
        const end = jointPositions.get(joint.id);
        if (!start || !end) continue;

        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const line = new THREE.Line(geometry, boneMaterial);
        group.add(line);
        boneGeos.push(geometry);
      }
      boneGeometriesRef.current.set(avatar.id, boneGeos);

      // ── Points (Instanced Mesh with GPU glow shader) ─
      const pointCount = avatar.points.length;
      if (pointCount > 0) {
        const instanceCount = Math.min(pointCount * 2, MAX_POINT_INSTANCES);
        const instancedMesh = new THREE.InstancedMesh(sharedSphereGeo, glowMaterial, instanceCount);
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const scaleAttr = new Float32Array(instanceCount);
        const colorAttr = new Float32Array(instanceCount * 3);
        const glowAttr = new Float32Array(instanceCount);

        const dummy = new THREE.Matrix4();
        const tempColor = new THREE.Color();

        for (let i = 0; i < pointCount; i++) {
          const point = avatar.points[i];
          const jointPos = jointPositions.get(point.joint_id);
          if (!jointPos) continue;

          let offset = new THREE.Vector3(...point.offset);
          let sizeScale = 1.0;

          // Apply current morph influences
          for (let ei = 0; ei < EMOTIONS.length; ei++) {
            const w = influences[ei];
            if (w <= 0) continue;
            const morph = morphTargets[EMOTIONS[ei]]?.[0];
            if (!morph?.point_morphs) continue;
            const pm = morph.point_morphs.find((m) => m.joint_id === point.joint_id);
            if (pm) {
              offset.add(new THREE.Vector3(...pm.offset_delta).multiplyScalar(w));
              sizeScale += (pm.size_scale - 1) * w;
            }
          }

          const worldPos = jointPos.clone().add(offset);
          const pointSize = point.size * 0.02 * sizeScale;

          // Core point
          dummy.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
          instancedMesh.setMatrixAt(i * 2, dummy);
          scaleAttr[i * 2] = pointSize / 0.02;
          tempColor.set(point.color || `#${HOLOGRAM_COLOR.toString(16)}`);
          colorAttr[i * 2 * 3] = tempColor.r;
          colorAttr[i * 2 * 3 + 1] = tempColor.g;
          colorAttr[i * 2 * 3 + 2] = tempColor.b;
          glowAttr[i * 2] = 0.5;

          // Glow sphere
          const glowIdx = i * 2 + 1;
          dummy.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
          instancedMesh.setMatrixAt(glowIdx, dummy);
          scaleAttr[glowIdx] = (pointSize * 1.75) / 0.02;
          colorAttr[glowIdx * 3] = tempColor.r;
          colorAttr[glowIdx * 3 + 1] = tempColor.g;
          colorAttr[glowIdx * 3 + 2] = tempColor.b;
          glowAttr[glowIdx] = 1.0;
        }

        instancedMesh.geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scaleAttr, 1));
        instancedMesh.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorAttr, 3));
        instancedMesh.geometry.setAttribute('instanceGlow', new THREE.InstancedBufferAttribute(glowAttr, 1));

        instancedMesh.count = Math.min(pointCount * 2, instanceCount);
        instancedMesh.instanceMatrix.needsUpdate = true;
        group.add(instancedMesh);

        instancedMeshRef.current.set(avatar.id, instancedMesh);
      }

      // ── Joint markers (only for joints with no points attached) ──
      const pointJointIds = new Set(avatar.points.map((p) => p.joint_id));
      const jointMaterial = new THREE.MeshBasicMaterial({
        color: HOLOGRAM_COLOR,
        transparent: true,
        opacity: 0.5,
      });
      const markerMap = new Map<string, THREE.Mesh>();
      for (const [jointId, pos] of jointPositions) {
        if (pointJointIds.has(jointId)) continue;
        const geo = new THREE.SphereGeometry(0.015, 6, 4);
        const marker = new THREE.Mesh(geo, jointMaterial);
        marker.position.copy(pos);
        group.add(marker);
        markerMap.set(jointId, marker);
      }
      jointMarkersRef.current.set(avatar.id, markerMap);

      return group;
    },
    [sharedSphereGeo, glowMaterial, resolveJointPositions],
  );

  // Initialize Three.js scene + cannon-es world
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, 1.2, 3);
    camera.lookAt(0, 0.8, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Ground grid (hologram aesthetic)
    const gridHelper = new THREE.GridHelper(4, 20, GRID_COLOR, GRID_COLOR);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.3;
    scene.add(gridHelper);

    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    // Cannon-es physics world
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    worldRef.current = world;

    // Ground plane
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      world.step(1 / 60, delta, 3);

      // ── Smooth morph interpolation ────────────────────
      for (const [avatarId, mState] of morphStateRef.current) {
        let needsUpdate = false;

        // Lerp each influence channel toward target
        for (let i = 0; i < EMOTIONS.length; i++) {
          const current = mState.currentInfluences[i];
          const target = mState.targetInfluences[i];
          if (Math.abs(current - target) > 0.001) {
            const step = MORPH_LERP_SPEED * delta;
            mState.currentInfluences[i] = current + Math.sign(target - current) * Math.min(step, Math.abs(target - current));
            needsUpdate = true;
          }
        }

        // Lerp overall weight
        if (Math.abs(mState.currentWeight - mState.targetWeight) > 0.001) {
          const step = MORPH_LERP_SPEED * delta;
          mState.currentWeight += Math.sign(mState.targetWeight - mState.currentWeight) * Math.min(step, Math.abs(mState.targetWeight - mState.currentWeight));
          needsUpdate = true;
        }

        if (needsUpdate || mState.dirty) {
          mState.dirty = false;
          const avatar = avatarsRef.current.find((a) => a.id === avatarId);
          if (avatar) {
            updateAvatarGeometry(avatar, mState);
          }
        }
      }

      // Sync IK chain physics body positions to joint markers
      for (const [avatarId, chains] of ikChainsRef.current) {
        const markers = jointMarkersRef.current.get(avatarId);
        if (!markers) continue;
        for (const chain of chains) {
          for (let i = 0; i < chain.jointIds.length; i++) {
            const body = chain.bodies[i];
            const marker = markers.get(chain.jointIds[i]);
            if (body && marker) {
              marker.position.set(body.position.x, body.position.y, body.position.z);
            }
          }
        }
      }

      // Slow rotation for hologram effect
      scene.traverse((obj) => {
        if (obj.type === 'Group' && obj.parent === scene) {
          obj.rotation.y += 0.002;
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      scene.clear();
      // Cleanup IK chains
      for (const [, chains] of ikChainsRef.current) {
        for (const chain of chains) {
          cleanupIKChain(chain, world);
        }
      }
      ikChainsRef.current.clear();
      instancedMeshRef.current.clear();
      jointMarkersRef.current.clear();
      boneGeometriesRef.current.clear();
      morphStateRef.current.clear();
    };
  }, [updateAvatarGeometry]);

  // Sync avatar groups when avatars prop changes
  useEffect(() => {
    const scene = sceneRef.current;
    const world = worldRef.current;
    if (!scene || !world) return;

    const currentIds = new Set(avatars.map((a) => a.id));
    const groups = avatarGroupsRef.current;

    // Remove avatars no longer present
    for (const [id, group] of groups) {
      if (!currentIds.has(id)) {
        scene.remove(group);
        groups.delete(id);
        instancedMeshRef.current.delete(id);
        jointMarkersRef.current.delete(id);
        boneGeometriesRef.current.delete(id);
        morphStateRef.current.delete(id);
        const chains = ikChainsRef.current.get(id);
        if (chains) {
          for (const chain of chains) {
            cleanupIKChain(chain, world);
          }
          ikChainsRef.current.delete(id);
        }
      }
    }

    // Add/update avatars
    for (const avatar of avatars) {
      // Initialize or update morph state
      let mState = morphStateRef.current.get(avatar.id);
      const targetEmotion = avatar.activeMorph || 'neutral';
      const targetWeight = avatar.morphWeight ?? 0;

      if (!mState) {
        // New avatar — set morph state, influences start at zero (will lerp)
        const targetInfluences = new Float32Array(EMOTIONS.length);
        const idx = EMOTION_INDEX[targetEmotion];
        if (idx !== undefined && targetEmotion !== 'neutral') {
          targetInfluences[idx] = targetWeight;
        }
        mState = {
          targetEmotion,
          targetWeight,
          currentWeight: 0,
          currentInfluences: new Float32Array(EMOTIONS.length),
          targetInfluences,
          dirty: true,
        };
        morphStateRef.current.set(avatar.id, mState);
      } else {
        // Existing avatar — update target (animation loop will lerp)
        mState.targetEmotion = targetEmotion;
        mState.targetWeight = targetWeight;
        // Reset target influences
        mState.targetInfluences.fill(0);
        const idx = EMOTION_INDEX[targetEmotion];
        if (idx !== undefined && targetEmotion !== 'neutral') {
          mState.targetInfluences[idx] = targetWeight;
        }
      }

      // Only rebuild group if avatar is new or structural data changed
      const existing = groups.get(avatar.id);
      const needsRebuild = !existing;

      if (needsRebuild) {
        if (existing) scene.remove(existing);
        const group = buildAvatarGroup(avatar);
        scene.add(group);
        groups.set(avatar.id, group);

        // Build IK chains for physics-enabled avatars
        if (avatar.physics) {
          const oldChains = ikChainsRef.current.get(avatar.id);
          if (oldChains) {
            for (const chain of oldChains) {
              cleanupIKChain(chain, world);
            }
          }

          const jointPositions = resolveJointPositions(avatar.skeleton, avatar.pose);
          const chains: IKChain[] = [];

          const leftArmIds = ['chest', 'l_shoulder', 'l_elbow', 'l_hand'].filter((id) =>
            avatar.skeleton.some((j) => j.id === id),
          );
          if (leftArmIds.length >= 2) {
            chains.push(buildIKChain(world, avatar.skeleton, jointPositions, leftArmIds));
          }

          const rightArmIds = ['chest', 'r_shoulder', 'r_elbow', 'r_hand'].filter((id) =>
            avatar.skeleton.some((j) => j.id === id),
          );
          if (rightArmIds.length >= 2) {
            chains.push(buildIKChain(world, avatar.skeleton, jointPositions, rightArmIds));
          }

          ikChainsRef.current.set(avatar.id, chains);
        }
      } else {
        // Morph-only change — mark dirty, animation loop handles geometry update
        mState.dirty = true;
      }
    }
  }, [avatars, buildAvatarGroup, resolveJointPositions]);

  if (avatars.length === 0) {
    return (
      <div className={classes.container}>
        <div className={classes.empty}>No hologram avatars in this room</div>
      </div>
    );
  }

  return (
    <div className={classes.container} ref={containerRef}>
      {avatars.length === 1 && <div className={classes.label}>{avatars[0].label}</div>}
    </div>
  );
};

export default HologramViewer;
