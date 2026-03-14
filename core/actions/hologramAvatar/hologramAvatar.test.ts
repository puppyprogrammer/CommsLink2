import { describe, it, expect, vi, beforeEach } from 'vitest';
import createAvatarAction from './createAvatarAction';
import updatePoseAction from './updatePoseAction';
import removeAvatarAction from './removeAvatarAction';
import loadAvatarsAction from './loadAvatarsAction';
import Data from '../../data';

vi.mock('../../data', () => ({
  default: {
    room: {
      findById: vi.fn(),
    },
    hologramAvatar: {
      create: vi.fn(),
      findById: vi.fn(),
      findByRoom: vi.fn(),
      findByRoomAndUser: vi.fn(),
      update: vi.fn(),
      updatePose: vi.fn(),
      remove: vi.fn(),
      removeByRoomAndUser: vi.fn(),
    },
  },
}));

const mockRoom = { id: 'room-1', name: 'test-room' };

const mockAvatar = {
  id: 'avatar-1',
  room_id: 'room-1',
  user_id: 'user-1',
  label: 'Test Avatar',
  skeleton: [{ id: 'root', position: [0, 0, 0], parent_id: null }],
  points: [{ joint_id: 'root', offset: [0, 0, 0], color: '#63c5c0', size: 3 }],
  pose: null,
  morph_targets: null,
  physics: true,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('createAvatarAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates avatar in a valid room', async () => {
    vi.mocked(Data.room.findById).mockResolvedValue(mockRoom as never);
    vi.mocked(Data.hologramAvatar.findByRoomAndUser).mockResolvedValue(null);
    vi.mocked(Data.hologramAvatar.create).mockResolvedValue(mockAvatar as never);

    const result = await createAvatarAction({
      roomId: 'room-1',
      userId: 'user-1',
      label: 'Test Avatar',
      skeleton: mockAvatar.skeleton,
      points: mockAvatar.points,
    });

    expect(Data.room.findById).toHaveBeenCalledWith('room-1');
    expect(Data.hologramAvatar.create).toHaveBeenCalled();
    expect(result.id).toBe('avatar-1');
  });

  it('throws not found for invalid room', async () => {
    vi.mocked(Data.room.findById).mockResolvedValue(null);

    await expect(
      createAvatarAction({
        roomId: 'bad-room',
        userId: 'user-1',
        label: 'Test',
        skeleton: [],
        points: [],
      }),
    ).rejects.toThrow();
  });

  it('removes existing avatar before creating (upsert)', async () => {
    vi.mocked(Data.room.findById).mockResolvedValue(mockRoom as never);
    vi.mocked(Data.hologramAvatar.findByRoomAndUser).mockResolvedValue(mockAvatar as never);
    vi.mocked(Data.hologramAvatar.remove).mockResolvedValue(mockAvatar as never);
    vi.mocked(Data.hologramAvatar.create).mockResolvedValue(mockAvatar as never);

    await createAvatarAction({
      roomId: 'room-1',
      userId: 'user-1',
      label: 'New Avatar',
      skeleton: [],
      points: [],
    });

    expect(Data.hologramAvatar.remove).toHaveBeenCalledWith('avatar-1');
    expect(Data.hologramAvatar.create).toHaveBeenCalled();
  });
});

describe('updatePoseAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates pose for avatar owner', async () => {
    vi.mocked(Data.hologramAvatar.findById).mockResolvedValue(mockAvatar as never);
    const newPose = { joints: { root: { rx: 0.5, ry: 0, rz: 0 } } };
    vi.mocked(Data.hologramAvatar.updatePose).mockResolvedValue({ ...mockAvatar, pose: newPose } as never);

    const result = await updatePoseAction('avatar-1', 'user-1', newPose);

    expect(Data.hologramAvatar.updatePose).toHaveBeenCalledWith('avatar-1', newPose);
    expect(result.pose).toEqual(newPose);
  });

  it('throws not found for missing avatar', async () => {
    vi.mocked(Data.hologramAvatar.findById).mockResolvedValue(null);

    await expect(updatePoseAction('bad-id', 'user-1', {})).rejects.toThrow();
  });

  it('throws forbidden for non-owner', async () => {
    vi.mocked(Data.hologramAvatar.findById).mockResolvedValue(mockAvatar as never);

    await expect(updatePoseAction('avatar-1', 'user-2', {})).rejects.toThrow();
  });
});

describe('removeAvatarAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes avatar for owner', async () => {
    vi.mocked(Data.hologramAvatar.findById).mockResolvedValue(mockAvatar as never);
    vi.mocked(Data.hologramAvatar.remove).mockResolvedValue(mockAvatar as never);

    const result = await removeAvatarAction('avatar-1', 'user-1');

    expect(Data.hologramAvatar.remove).toHaveBeenCalledWith('avatar-1');
    expect(result).toEqual({ success: true });
  });

  it('throws not found for missing avatar', async () => {
    vi.mocked(Data.hologramAvatar.findById).mockResolvedValue(null);

    await expect(removeAvatarAction('bad-id', 'user-1')).rejects.toThrow();
  });

  it('throws forbidden for non-owner', async () => {
    vi.mocked(Data.hologramAvatar.findById).mockResolvedValue(mockAvatar as never);

    await expect(removeAvatarAction('avatar-1', 'user-2')).rejects.toThrow();
  });
});

describe('loadAvatarsAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all avatars for a room', async () => {
    vi.mocked(Data.hologramAvatar.findByRoom).mockResolvedValue([mockAvatar] as never);

    const result = await loadAvatarsAction('room-1');

    expect(Data.hologramAvatar.findByRoom).toHaveBeenCalledWith('room-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('avatar-1');
  });

  it('returns empty array when no avatars', async () => {
    vi.mocked(Data.hologramAvatar.findByRoom).mockResolvedValue([]);

    const result = await loadAvatarsAction('room-1');

    expect(result).toHaveLength(0);
  });
});
