import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Initialize the state of the node
  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  let isRunning = false;
  let receivedMessagesPhase1: { round: number; value: Value }[] = [];
  let receivedMessagesPhase2: { round: number; value: Value }[] = [];

  async function broadcastVote(value: Value, phase: number, round: number) {
    if (isFaulty || state.killed) {
      return;
    }
    const promises = [];
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        promises.push(
          fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ value, phase, round }),
          })
        );
      }
    }
    await Promise.all(promises);
  }

  async function startConsensus() {
    if (isFaulty || state.killed) {
      return;
    }

    await broadcastVote(state.x!, 1, state.k!);

    let phase1Messages = receivedMessagesPhase1.filter((m) => m.round === state.k);
    let counts1 = { 0: 0, 1: 0 };

    phase1Messages.forEach((m) => {
      if (m.value === 0 || m.value === 1) {
        counts1[m.value]++;
      }
    });
    let proposition: Value;
    let threshold = Math.floor((N + 1) / 2);
    if (counts1[1] >= threshold) {
      proposition = 1;
    } else if (counts1[0] >= threshold) {
      proposition = 0;
    } else {
      proposition = 1;
    }

    await broadcastVote(proposition, 2, state.k!);
    let phase2Messages = receivedMessagesPhase2.filter((m) => m.round === state.k);
    const counts2 = { 0: 0, 1: 0 };
    phase2Messages.forEach((m) => {
      if (m.value === 0 || m.value === 1) {
        counts2[m.value]++;
      }
    });

    threshold = Math.ceil((N - F) / 2);

    if (F * 2 < N) {
      if (counts2[1] >= threshold) {
        state.x = 1;
        state.decided = true;
      } else if (counts2[0] >= threshold) {
        state.x = 0;
        state.decided = true;
      } else {
        state.x = proposition;
        state.decided = state.k! >= 1;
      }
    } else {
      state.x = proposition;
      state.decided = false;
    }

    state.k!++;

    if (!state.decided) {
      setImmediate(startConsensus);
    }
  }

  // TO-DO
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  node.post("/message", (req, res) => {
    if (state.killed || isFaulty) {
      return res.status(500).send("node not working");
    }
    const { value, phase, round } = req.body;
    if (phase === 1) {
      receivedMessagesPhase1.push({ round, value });
    } else {
      receivedMessagesPhase2.push({ round, value });
    }
    return res.status(200).send("message received");
  });

  node.get("/start", async (req, res) => {
    if (isFaulty || isRunning) {
      res.status(400).send("cannot start");
      return;
    }
    receivedMessagesPhase1 = [];
    receivedMessagesPhase2 = [];
    state.k = 0;
    state.x = initialValue;
    state.decided = false;
    setTimeout(startConsensus, 100);
    res.json({ started: true });
  });

  node.get("/stop", async (req, res) => {
    if (state.killed) {
      return res.status(400).send("already killed");
    }
    isRunning = false;
    state.killed = true;
    return res.status(200).send("stopped");
  });

  node.get("/getState", (req, res) => {
    res.status(200).json(state).send();
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
