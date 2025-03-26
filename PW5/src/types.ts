export type NodeState = {
  killed: boolean;
  x: Value | null;
  decided: boolean | null;
  k: number | null;
};

export type nodeMessage = {
  type: 0 | 1
  x: Value | null
  k: number
  nodeId: number
}

export type Value = 0 | 1 | "?";