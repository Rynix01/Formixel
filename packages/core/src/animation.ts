import { assertModel, type Model, type Vec3, type Track } from './model.js';
export interface BonePose {
  rotation: Vec3;
  position: Vec3;
  scale: Vec3;
}
const sample = (track: Track, time: number): Vec3 => {
  const frames = track.keyframes;
  if (time <= frames[0]!.time) return [...frames[0]!.value];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!,
      b = frames[i]!;
    if (time <= b.time) {
      if (time === b.time) return [...b.value];
      if (a.interpolation === 'step') return [...a.value];
      const f = (time - a.time) / (b.time - a.time);
      return a.value.map((v, j) => v + (b.value[j]! - v) * f) as Vec3;
    }
  }
  return [...frames.at(-1)!.value];
};
export function sampleAnimation(model: Model, id: string, time: number): Map<string, BonePose> {
  assertModel(model);
  if (!Number.isFinite(time) || time < 0)
    throw new Error('Animation time must be finite and nonnegative');
  const animation = model.animations?.find((a) => a.id === id || a.name === id);
  if (!animation) throw new Error(`Unknown animation ${id}`);
  const t = animation.loop ? time % animation.length : Math.min(time, animation.length);
  const poses = new Map<string, BonePose>();
  for (const track of animation.tracks) {
    let pose = poses.get(track.group);
    if (!pose) {
      pose = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] };
      poses.set(track.group, pose);
    }
    pose[track.channel] = sample(track, t);
  }
  return poses;
}
