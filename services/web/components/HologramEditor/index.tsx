'use client';

// React modules
import { useState, useCallback } from 'react';

// Node modules
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';

// Styles
import classes from './HologramEditor.module.scss';

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

type HologramEditorProps = {
  onSave: (data: {
    label: string;
    skeleton: JointDef[];
    points: PointDef[];
    pose: { joints: Record<string, PoseJoint> };
    physics: boolean;
  }) => void;
  onCancel: () => void;
  onEmotionChange?: (emotion: string, weight: number) => void;
  showEmotionControls?: boolean;
};

// ── Presets ────────────────────────────────────────────

const HUMANOID_SKELETON: JointDef[] = [
  { id: 'root', position: [0, 0, 0], parent_id: null },
  { id: 'spine', position: [0, 0.20, 0], parent_id: 'root' },
  { id: 'chest', position: [0, 0.18, 0], parent_id: 'spine' },
  { id: 'neck', position: [0, 0.10, 0], parent_id: 'chest' },
  { id: 'head', position: [0, 0.10, 0], parent_id: 'neck' },
  { id: 'l_shoulder', position: [-0.15, 0, 0], parent_id: 'chest' },
  { id: 'l_elbow', position: [0, -0.16, 0], parent_id: 'l_shoulder' },
  { id: 'l_hand', position: [0, -0.14, 0], parent_id: 'l_elbow' },
  { id: 'r_shoulder', position: [0.15, 0, 0], parent_id: 'chest' },
  { id: 'r_elbow', position: [0, -0.16, 0], parent_id: 'r_shoulder' },
  { id: 'r_hand', position: [0, -0.14, 0], parent_id: 'r_elbow' },
  { id: 'l_hip', position: [-0.1, 0, 0], parent_id: 'root' },
  { id: 'l_knee', position: [0, -0.36, 0], parent_id: 'l_hip' },
  { id: 'l_foot', position: [0, -0.34, 0], parent_id: 'l_knee' },
  { id: 'r_hip', position: [0.1, 0, 0], parent_id: 'root' },
  { id: 'r_knee', position: [0, -0.36, 0], parent_id: 'r_hip' },
  { id: 'r_foot', position: [0, -0.34, 0], parent_id: 'r_knee' },
];

const HUMANOID_POINTS: PointDef[] = [
  { joint_id: 'head', offset: [0, 0.08, 0], color: '#63c5c0', size: 4 },
  { joint_id: 'head', offset: [-0.03, 0.1, 0.05], color: '#63c5c0', size: 1.5 },
  { joint_id: 'head', offset: [0.03, 0.1, 0.05], color: '#63c5c0', size: 1.5 },
  { joint_id: 'chest', offset: [0, 0, 0.05], color: '#4db8b3', size: 2 },
  { joint_id: 'l_hand', offset: [0, 0, 0], color: '#63c5c0', size: 2 },
  { joint_id: 'r_hand', offset: [0, 0, 0], color: '#63c5c0', size: 2 },
  { joint_id: 'l_foot', offset: [0, -0.02, 0.03], color: '#4db8b3', size: 2 },
  { joint_id: 'r_foot', offset: [0, -0.02, 0.03], color: '#4db8b3', size: 2 },
  { joint_id: 'l_shoulder', offset: [0, 0.02, 0], color: '#3a9994', size: 1.5 },
  { joint_id: 'r_shoulder', offset: [0, 0.02, 0], color: '#3a9994', size: 1.5 },
];

const ORB_SKELETON: JointDef[] = [
  { id: 'center', position: [0, 1, 0], parent_id: null },
  { id: 'ring_n', position: [0, 0, 0.3], parent_id: 'center' },
  { id: 'ring_s', position: [0, 0, -0.3], parent_id: 'center' },
  { id: 'ring_e', position: [0.3, 0, 0], parent_id: 'center' },
  { id: 'ring_w', position: [-0.3, 0, 0], parent_id: 'center' },
  { id: 'top', position: [0, 0.3, 0], parent_id: 'center' },
  { id: 'bottom', position: [0, -0.3, 0], parent_id: 'center' },
];

const ORB_POINTS: PointDef[] = [
  { joint_id: 'center', offset: [0, 0, 0], color: '#ff6b9d', size: 5 },
  { joint_id: 'ring_n', offset: [0, 0, 0], color: '#c44dff', size: 2 },
  { joint_id: 'ring_s', offset: [0, 0, 0], color: '#c44dff', size: 2 },
  { joint_id: 'ring_e', offset: [0, 0, 0], color: '#c44dff', size: 2 },
  { joint_id: 'ring_w', offset: [0, 0, 0], color: '#c44dff', size: 2 },
  { joint_id: 'top', offset: [0, 0, 0], color: '#ff6b9d', size: 3 },
  { joint_id: 'bottom', offset: [0, 0, 0], color: '#ff6b9d', size: 3 },
];

// ── Component ──────────────────────────────────────────

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry'] as const;

const HologramEditor: React.FC<HologramEditorProps> = ({ onSave, onCancel, onEmotionChange, showEmotionControls }) => {
  const [label, setLabel] = useState('My Avatar');
  const [skeleton, setSkeleton] = useState<JointDef[]>(HUMANOID_SKELETON);
  const [points, setPoints] = useState<PointDef[]>(HUMANOID_POINTS);
  const [physics, setPhysics] = useState(true);
  const [pose, setPose] = useState<Record<string, PoseJoint>>({});
  const [selectedEmotion, setSelectedEmotion] = useState<string>('neutral');
  const [emotionWeight, setEmotionWeight] = useState<number>(0);

  const loadPreset = useCallback((preset: 'humanoid' | 'orb') => {
    if (preset === 'humanoid') {
      setSkeleton(HUMANOID_SKELETON);
      setPoints(HUMANOID_POINTS);
    } else {
      setSkeleton(ORB_SKELETON);
      setPoints(ORB_POINTS);
    }
    setPose({});
  }, []);

  const updateJointPose = useCallback((jointId: string, axis: 'rx' | 'ry' | 'rz', value: number) => {
    setPose((prev) => ({
      ...prev,
      [jointId]: {
        rx: prev[jointId]?.rx ?? 0,
        ry: prev[jointId]?.ry ?? 0,
        rz: prev[jointId]?.rz ?? 0,
        [axis]: value,
      },
    }));
  }, []);

  const handleSave = useCallback(() => {
    onSave({
      label,
      skeleton,
      points,
      pose: { joints: pose },
      physics,
    });
  }, [label, skeleton, points, pose, physics, onSave]);

  const posableJoints = skeleton.filter((j) => j.parent_id !== null);

  return (
    <div className={classes.editor}>
      <Typography variant="subtitle2" sx={{ color: '#63c5c0', fontWeight: 700 }}>
        Hologram Avatar Editor
      </Typography>

      <TextField
        label="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        size="small"
        fullWidth
        slotProps={{ inputLabel: { sx: { color: '#888' } }, input: { sx: { color: '#ddd' } } }}
      />

      <div className={classes.presetRow}>
        <Button size="small" variant="outlined" onClick={() => loadPreset('humanoid')}>
          Humanoid
        </Button>
        <Button size="small" variant="outlined" onClick={() => loadPreset('orb')}>
          Orb
        </Button>
      </div>

      <FormControlLabel
        control={<Switch checked={physics} onChange={(e) => setPhysics(e.target.checked)} size="small" />}
        label={
          <Typography variant="caption" sx={{ color: '#aaa' }}>
            Physics enabled
          </Typography>
        }
      />

      <Typography variant="caption" sx={{ color: '#888' }}>
        Pose Joints ({posableJoints.length})
      </Typography>

      <div className={classes.jointList}>
        {posableJoints.map((joint) => (
          <div key={joint.id} className={classes.jointItem}>
            <span className={classes.jointName}>{joint.id}</span>
            {(['rx', 'ry', 'rz'] as const).map((axis) => (
              <div key={axis} className={classes.sliderGroup}>
                <span className={classes.sliderLabel}>{axis[1].toUpperCase()}</span>
                <Slider
                  size="small"
                  min={-Math.PI}
                  max={Math.PI}
                  step={0.05}
                  value={pose[joint.id]?.[axis] ?? 0}
                  onChange={(_, v) => updateJointPose(joint.id, axis, v as number)}
                  sx={{ width: 60, color: '#63c5c0' }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      {showEmotionControls && (
        <>
          <Typography variant="caption" sx={{ color: '#888', mt: 1 }}>
            Emotion Morph
          </Typography>
          <FormControl size="small" fullWidth>
            <InputLabel sx={{ color: '#888' }}>Emotion</InputLabel>
            <Select
              value={selectedEmotion}
              label="Emotion"
              onChange={(e) => {
                const emotion = e.target.value;
                setSelectedEmotion(emotion);
                const weight = emotion === 'neutral' ? 0 : emotionWeight;
                onEmotionChange?.(emotion, weight);
              }}
              sx={{ color: '#ddd', '.MuiOutlinedInput-notchedOutline': { borderColor: '#555' } }}
            >
              {EMOTIONS.map((e) => (
                <MenuItem key={e} value={e}>
                  {e.charAt(0).toUpperCase() + e.slice(1)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <div className={classes.sliderGroup} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography variant="caption" sx={{ color: '#888', minWidth: 50 }}>
              Blend
            </Typography>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={emotionWeight}
              onChange={(_, v) => {
                const w = v as number;
                setEmotionWeight(w);
                onEmotionChange?.(selectedEmotion, w);
              }}
              disabled={selectedEmotion === 'neutral'}
              sx={{ color: '#63c5c0', flex: 1 }}
            />
            <Typography variant="caption" sx={{ color: '#aaa', minWidth: 30 }}>
              {emotionWeight.toFixed(2)}
            </Typography>
          </div>
        </>
      )}

      <div className={classes.actions}>
        <Button size="small" variant="text" onClick={onCancel} sx={{ color: '#888' }}>
          Cancel
        </Button>
        <Button size="small" variant="contained" onClick={handleSave} sx={{ backgroundColor: '#63c5c0' }}>
          Create Avatar
        </Button>
      </div>
    </div>
  );
};

export default HologramEditor;
