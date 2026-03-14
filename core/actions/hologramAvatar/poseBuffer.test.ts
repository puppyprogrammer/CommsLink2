import { describe, it, expect } from 'vitest';
import { packPoseBuffer, unpackPoseBuffer, POSE_BUFFER_BYTE_SIZE } from './poseBuffer';
import type { PoseBufferFrame } from '../../interfaces/hologram';

describe('poseBuffer', () => {
  const makeFrame = (overrides?: Partial<PoseBufferFrame>): PoseBufferFrame => ({
    jointRotations: {
      root: { rx: 0, ry: 0, rz: 0 },
      head: { rx: 0.15, ry: 0.2, rz: 0 },
      r_shoulder: { rx: 0, ry: 0, rz: -2.5 },
      r_elbow: { rx: 0.5, ry: 0, rz: 0 },
    },
    morphWeights: [0.8, 0.1, 0.0, 0.1],
    emotionIdx: 0,
    timestamp: 1234567890,
    ...overrides,
  });

  it('packPoseBuffer produces correct byte size', () => {
    const frame = makeFrame();
    const packed = packPoseBuffer(frame);
    expect(packed.byteLength).toBe(POSE_BUFFER_BYTE_SIZE);
    expect(packed).toBeInstanceOf(Uint8Array);
  });

  it('pack/unpack roundtrips joint rotations correctly', () => {
    const frame = makeFrame();
    const packed = packPoseBuffer(frame);
    const unpacked = unpackPoseBuffer(packed);

    expect(unpacked).not.toBeNull();
    if (!unpacked) return;

    // head joint should roundtrip
    expect(unpacked.jointRotations['head']).toBeDefined();
    expect(unpacked.jointRotations['head'].rx).toBeCloseTo(0.15, 4);
    expect(unpacked.jointRotations['head'].ry).toBeCloseTo(0.2, 4);
    expect(unpacked.jointRotations['head'].rz).toBeCloseTo(0, 4);

    // r_shoulder should roundtrip
    expect(unpacked.jointRotations['r_shoulder']).toBeDefined();
    expect(unpacked.jointRotations['r_shoulder'].rz).toBeCloseTo(-2.5, 4);
  });

  it('zero-valued joints are omitted in output (sparse)', () => {
    const frame = makeFrame({
      jointRotations: {
        head: { rx: 0.1, ry: 0, rz: 0 },
      },
    });
    const packed = packPoseBuffer(frame);
    const unpacked = unpackPoseBuffer(packed);

    expect(unpacked).not.toBeNull();
    if (!unpacked) return;

    // root has all zeros → should NOT be in output
    expect(unpacked.jointRotations['root']).toBeUndefined();
    // head has non-zero rx → should be in output
    expect(unpacked.jointRotations['head']).toBeDefined();
  });

  it('morph weights roundtrip correctly', () => {
    const frame = makeFrame();
    const packed = packPoseBuffer(frame);
    const unpacked = unpackPoseBuffer(packed);

    expect(unpacked).not.toBeNull();
    if (!unpacked) return;

    expect(unpacked.morphWeights[0]).toBeCloseTo(0.8, 4);
    expect(unpacked.morphWeights[1]).toBeCloseTo(0.1, 4);
    expect(unpacked.morphWeights[2]).toBeCloseTo(0.0, 4);
    expect(unpacked.morphWeights[3]).toBeCloseTo(0.1, 4);
  });

  it('emotionIdx roundtrips correctly', () => {
    for (let idx = 0; idx < 4; idx++) {
      const frame = makeFrame({ emotionIdx: idx });
      const packed = packPoseBuffer(frame);
      const unpacked = unpackPoseBuffer(packed);

      expect(unpacked).not.toBeNull();
      expect(unpacked!.emotionIdx).toBe(idx);
    }
  });

  it('timestamp roundtrips correctly', () => {
    const frame = makeFrame({ timestamp: 0xdeadbeef });
    const packed = packPoseBuffer(frame);
    const unpacked = unpackPoseBuffer(packed);

    expect(unpacked).not.toBeNull();
    expect(unpacked!.timestamp).toBe(0xdeadbeef);
  });

  it('unpack returns null for undersized buffer', () => {
    const tiny = new Uint8Array(10);
    expect(unpackPoseBuffer(tiny)).toBeNull();
  });

  it('unpack handles ArrayBuffer input', () => {
    const frame = makeFrame();
    const packed = packPoseBuffer(frame);
    const unpacked = unpackPoseBuffer(packed.buffer);

    expect(unpacked).not.toBeNull();
    expect(unpacked!.emotionIdx).toBe(0);
  });

  it('empty joints results in all-zero rotations', () => {
    const frame = makeFrame({ jointRotations: {} });
    const packed = packPoseBuffer(frame);
    const unpacked = unpackPoseBuffer(packed);

    expect(unpacked).not.toBeNull();
    // All joints zero → sparse output should be empty
    expect(Object.keys(unpacked!.jointRotations).length).toBe(0);
  });

  it('binary size is fixed at 261 bytes regardless of content', () => {
    // Sparse frame (few joints)
    const sparse = makeFrame({ jointRotations: { head: { rx: 0.1, ry: 0, rz: 0 } } });
    // Dense frame (many joints)
    const dense = makeFrame();

    const packedSparse = packPoseBuffer(sparse);
    const packedDense = packPoseBuffer(dense);

    // Both should be exactly 261 bytes (fixed binary layout)
    expect(packedSparse.byteLength).toBe(POSE_BUFFER_BYTE_SIZE);
    expect(packedDense.byteLength).toBe(POSE_BUFFER_BYTE_SIZE);
    expect(packedSparse.byteLength).toBe(packedDense.byteLength);

    // Dense JSON is much larger than binary
    const denseJson = JSON.stringify({
      jointRotations: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`joint_${i}`, { rx: 0.5, ry: -0.3, rz: 1.2 }]),
      ),
      morphWeights: [0.8, 0.1, 0.0, 0.1],
      emotionIdx: 0,
      timestamp: 1234567890,
    });
    const jsonSize = new TextEncoder().encode(denseJson).byteLength;
    expect(packedDense.byteLength).toBeLessThan(jsonSize);
  });
});
