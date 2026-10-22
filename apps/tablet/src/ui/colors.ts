import { gremlinAvatars } from '@swag/design-tokens';

/** Body colour of a child: their avatar if it is a Gremlin, else their profile colour. */
export const kidColor = (child: { avatar_key: string; color: string }) =>
  gremlinAvatars[child.avatar_key as keyof typeof gremlinAvatars] ?? child.color;

/** Parents have a round initial in these colours, in family order. */
export const PARENT_COLORS = ['#6B4EFF', '#3DBE7A', '#FF8A3D', '#3B9BF0'];
/** A parent's colour: the one they chose, else the one their order in the family gives them. */
export const parentColor = (parent: { avatar_key?: string | null }, index: number) =>
  gremlinAvatars[(parent.avatar_key ?? '') as keyof typeof gremlinAvatars] ?? PARENT_COLORS[index % PARENT_COLORS.length]!;

