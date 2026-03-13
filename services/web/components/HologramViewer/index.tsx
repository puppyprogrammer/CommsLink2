'use client';

// React modules
import { useEffect, useRef, useCallback } from 'react';

// Node modules
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

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

type AvatarData = {
  id: string;
  userId: string;
  label: string;
  skeleton: JointDef[];
  points: PointDef[];
  pose: PoseData | null;
  physics: boolean;
};

type HologramViewerProps = {
  avatars: AvatarData[];
};

// ── Constants ──────────────────────────────────────────

const HOLOGRAM_COLOR = 0x63c5c0;
const BONE_COLOR = 0x2a7a76;
const GRID_COLOR = 0x1a3a38;

// ── Component ──────────────────────────────────────────

const HologramViewer: React.FC<HologramViewerProps> = ({ avatars }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const worldRef = useRef<CANNON.World | null>(null);
  const frameRef = useRef<number>(0);
  const avatarGroupsRef = useRef<Map<string, THREE.Group>>(new Map());

  // Build a single avatar's skeleton + points as a Three.js group
  const buildAvatarGroup = useCallback((avatar: AvatarData): THREE.Group => {
    const group = new THREE.Group();
    group.name = avatar.id;

    const jointPositions = new Map<string, THREE.Vector3>();

    // Resolve absolute positions for each joint
    for (const joint of avatar.skeleton) {
      const base = new THREE.Vector3(...joint.position);
      if (joint.parent_id && jointPositions.has(joint.parent_id)) {
        base.add(jointPositions.get(joint.parent_id)!);
      }
      jointPositions.set(joint.id, base);
    }

    // Apply pose rotations
    if (avatar.pose?.joints) {
      const orderedJoints = [...avatar.skeleton];
      for (const joint of orderedJoints) {
        const poseJoint = avatar.pose.joints[joint.id];
        if (!poseJoint) continue;

        const pos = jointPositions.get(joint.id);
        if (!pos || !joint.parent_id) continue;

        const parentPos = jointPositions.get(joint.parent_id);
        if (!parentPos) continue;

        // Rotate around parent
        const offset = pos.clone().sub(parentPos);
        const euler = new THREE.Euler(poseJoint.rx, poseJoint.ry, poseJoint.rz);
        offset.applyEuler(euler);
        jointPositions.set(joint.id, parentPos.clone().add(offset));

        // Propagate rotation to children
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

    // Draw bones (lines between joints)
    const boneMaterial = new THREE.LineBasicMaterial({
      color: BONE_COLOR,
      linewidth: 2,
      transparent: true,
      opacity: 0.6,
    });
    for (const joint of avatar.skeleton) {
      if (!joint.parent_id) continue;
      const start = jointPositions.get(joint.parent_id);
      const end = jointPositions.get(joint.id);
      if (!start || !end) continue;

      const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geometry, boneMaterial);
      group.add(line);
    }

    // Draw points
    for (const point of avatar.points) {
      const jointPos = jointPositions.get(point.joint_id);
      if (!jointPos) continue;

      const offset = new THREE.Vector3(...point.offset);
      const worldPos = jointPos.clone().add(offset);

      const color = new THREE.Color(point.color || `#${HOLOGRAM_COLOR.toString(16)}`);
      const geometry = new THREE.SphereGeometry(point.size * 0.02, 8, 6);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(worldPos);
      group.add(mesh);

      // Glow sphere
      const glowGeometry = new THREE.SphereGeometry(point.size * 0.035, 8, 6);
      const glowMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.15,
      });
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      glow.position.copy(worldPos);
      group.add(glow);
    }

    // Draw joint markers
    const jointMaterial = new THREE.MeshBasicMaterial({ color: HOLOGRAM_COLOR, transparent: true, opacity: 0.5 });
    for (const [, pos] of jointPositions) {
      const geo = new THREE.SphereGeometry(0.015, 6, 4);
      const marker = new THREE.Mesh(geo, jointMaterial);
      marker.position.copy(pos);
      group.add(marker);
    }

    return group;
  }, []);

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
    };
  }, []);

  // Sync avatar groups when avatars prop changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentIds = new Set(avatars.map((a) => a.id));
    const groups = avatarGroupsRef.current;

    // Remove avatars no longer present
    for (const [id, group] of groups) {
      if (!currentIds.has(id)) {
        scene.remove(group);
        groups.delete(id);
      }
    }

    // Add/update avatars
    for (const avatar of avatars) {
      const existing = groups.get(avatar.id);
      if (existing) {
        scene.remove(existing);
      }
      const group = buildAvatarGroup(avatar);
      scene.add(group);
      groups.set(avatar.id, group);
    }
  }, [avatars, buildAvatarGroup]);

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
