// ┌──────────────────────────────────────────┐
// │ Formation Position Calculator            │
// └──────────────────────────────────────────┘

type FormationAssignment = {
  pos: [number, number, number];
  rot: number;
};

type FormationParams = {
  type: string;
  center: [number, number, number];
  facing: number; // degrees
  width?: number;
  depth?: number;
  radius?: number;
  size?: number;
  spacing?: number;
};

const DEFAULT_SPACING = 2.0;

const calculateFormationPositions = (
  params: FormationParams,
  unitCount: number,
): FormationAssignment[] => {
  const { type, center, facing } = params;
  const spacing = params.spacing || DEFAULT_SPACING;
  const facingRad = facing * Math.PI / 180;
  // Right = perpendicular to facing, Forward = facing direction
  const rightX = Math.cos(facingRad);
  const rightZ = -Math.sin(facingRad);
  const fwdX = Math.sin(facingRad);
  const fwdZ = Math.cos(facingRad);

  const positions: FormationAssignment[] = [];

  switch (type) {
    case 'line': {
      const width = params.width || unitCount * spacing;
      const unitsPerRow = Math.max(1, Math.floor(width / spacing));
      for (let i = 0; i < unitCount; i++) {
        const row = Math.floor(i / unitsPerRow);
        const col = i % unitsPerRow;
        const rowCount = Math.min(unitsPerRow, unitCount - row * unitsPerRow);
        const offsetRight = (col - (rowCount - 1) / 2) * spacing;
        const offsetFwd = -row * spacing * 1.5;
        positions.push({
          pos: [
            center[0] + rightX * offsetRight + fwdX * offsetFwd,
            center[1],
            center[2] + rightZ * offsetRight + fwdZ * offsetFwd,
          ],
          rot: facing,
        });
      }
      break;
    }

    case 'column': {
      const depth = params.depth || unitCount * spacing;
      const colSpacing = Math.max(spacing, depth / unitCount);
      for (let i = 0; i < unitCount; i++) {
        const offsetFwd = -i * colSpacing;
        positions.push({
          pos: [
            center[0] + fwdX * offsetFwd,
            center[1],
            center[2] + fwdZ * offsetFwd,
          ],
          rot: facing,
        });
      }
      break;
    }

    case 'shield_wall': {
      const width = params.width || unitCount * (spacing * 0.6);
      const tightSpacing = Math.max(1.0, width / Math.max(1, unitCount));
      const unitsPerRow = Math.max(1, Math.ceil(width / tightSpacing));
      for (let i = 0; i < unitCount; i++) {
        const row = Math.floor(i / unitsPerRow);
        const col = i % unitsPerRow;
        const rowCount = Math.min(unitsPerRow, unitCount - row * unitsPerRow);
        const offsetRight = (col - (rowCount - 1) / 2) * tightSpacing;
        const offsetFwd = -row * spacing;
        positions.push({
          pos: [
            center[0] + rightX * offsetRight + fwdX * offsetFwd,
            center[1],
            center[2] + rightZ * offsetRight + fwdZ * offsetFwd,
          ],
          rot: facing,
        });
      }
      break;
    }

    case 'wedge': {
      const wedgeSpacing = spacing * 1.5;
      let placed = 0;
      let row = 0;
      while (placed < unitCount) {
        const unitsInRow = row + 1;
        for (let col = 0; col < unitsInRow && placed < unitCount; col++) {
          const offsetRight = (col - (unitsInRow - 1) / 2) * wedgeSpacing;
          const offsetFwd = -row * wedgeSpacing;
          positions.push({
            pos: [
              center[0] + rightX * offsetRight + fwdX * offsetFwd,
              center[1],
              center[2] + rightZ * offsetRight + fwdZ * offsetFwd,
            ],
            rot: facing,
          });
          placed++;
        }
        row++;
      }
      break;
    }

    case 'circle': {
      const radius = params.radius || Math.max(3, unitCount * 0.5);
      for (let i = 0; i < unitCount; i++) {
        const angle = (i / unitCount) * Math.PI * 2;
        const outwardFacing = (angle * 180 / Math.PI + 90) % 360;
        positions.push({
          pos: [
            center[0] + Math.cos(angle) * radius,
            center[1],
            center[2] + Math.sin(angle) * radius,
          ],
          rot: outwardFacing,
        });
      }
      break;
    }

    case 'square': {
      const sideLength = params.size || Math.max(4, Math.ceil(Math.sqrt(unitCount)) * spacing);
      const unitsPerSide = Math.max(2, Math.ceil(Math.sqrt(unitCount)));
      const sqSpacing = sideLength / (unitsPerSide - 1);
      for (let i = 0; i < unitCount; i++) {
        const row = Math.floor(i / unitsPerSide);
        const col = i % unitsPerSide;
        const offsetRight = (col - (unitsPerSide - 1) / 2) * sqSpacing;
        const offsetFwd = (row - (unitsPerSide - 1) / 2) * sqSpacing;
        positions.push({
          pos: [
            center[0] + rightX * offsetRight + fwdX * offsetFwd,
            center[1],
            center[2] + rightZ * offsetRight + fwdZ * offsetFwd,
          ],
          rot: facing,
        });
      }
      break;
    }

    case 'loose':
    default: {
      const looseRadius = params.radius || Math.max(5, unitCount * 0.5);
      for (let i = 0; i < unitCount; i++) {
        // Spread evenly in a loose cluster using golden angle
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const r = looseRadius * Math.sqrt(i / unitCount);
        const theta = i * goldenAngle;
        positions.push({
          pos: [
            center[0] + Math.cos(theta) * r,
            center[1],
            center[2] + Math.sin(theta) * r,
          ],
          rot: facing,
        });
      }
      break;
    }
  }

  return positions;
};

export type { FormationAssignment, FormationParams };
export { calculateFormationPositions };
