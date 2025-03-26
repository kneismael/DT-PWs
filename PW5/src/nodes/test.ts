import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState, Message } from "../types";


const messages: Record<number, Record<string, Message[]>> = {};
declare global {
  var StatesOfNodes: Record<number, NodeState>;
}

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

  if (!globalThis.StatesOfNodes) {
    globalThis.StatesOfNodes = {};
  }

  globalThis.StatesOfNodes[nodeId] = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  function storeMessage(message: Message): void {
    const { k, type } = message;
  
    messages[k] = messages[k] || { "R": [], "P": [] };
  
    // Vérifier si le message du même nodeId et type existe déjà
    const nodeExists = messages[k][type].find(msg => msg.nodeId === message.nodeId);
  
    // Si le message n'existe pas, l'ajouter
    if (!nodeExists) {
      messages[k][type].push(message);
    }
  }
  

  function getMessages(k: number, phase: "R" | "P"): Message[] {
    return messages[k][phase]
  }

  function getMessagesLen(k: number, phase: "R" | "P"): number {
    if (!messages[k]) return 0;
    return messages[k][phase].length
  }
  
  async function sendMessage(type: "R" | "P", k: number, x: Value | null) {
    for (let i = 0; i < N; i++) {
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, nodeId, k, x } ),
      }).catch(() => {}); // Avoid crashes if a node is unreachable
    }
  }

  function countValue(messages: Message[]): Record<Value, number> {
    const valueCounts = { 0: 0, 1: 0, "?": 0 };
  
    messages.forEach(msg => {
      if (msg.x !== null) {
        switch (msg.x) {
          case 0:
            valueCounts[0]++;
            break;
          case 1:
            valueCounts[1]++;
            break;
          case "?":
            valueCounts["?"]++;
            break;
          default:
            break;
        }
      }
    });
  
    return valueCounts;
  }
  

  async function benOrAlgo() {
    while (!globalThis.StatesOfNodes[nodeId].decided) {
      // Vérifier si le nœud est défectueux et le sortir de l'algorithme
      if (globalThis.StatesOfNodes[nodeId].killed || isFaulty) {
        return;
      }
  
      globalThis.StatesOfNodes[nodeId].k! += 1;
      let k = globalThis.StatesOfNodes[nodeId].k!;
      let x = globalThis.StatesOfNodes[nodeId].x!;
      await sendMessage("R", k, x);
  
      while (getMessagesLen(k, "R") < N - F) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
  
      const messages_R = getMessages(k, "R");
      const nb_val_R = Object.entries(countValue(messages_R))
                          .filter(([_, count]) => count > N / 2)
                          .map(([key, _]) => (key === "0" ? 0 : key === "1" ? 1 : "?")) as Value[];
  
      if (nb_val_R.length > 0) {
        await sendMessage("P", k, nb_val_R[0]);
      } else {
        await sendMessage("P", k, "?");
      }
  
      while (getMessagesLen(k, "P") < N - F) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
  
      const messages_P = getMessages(k, "P");
      const nb_val_P = Object.entries(countValue(messages_P))
                          .filter(([key, count]) => count >= F + 1 && key !== "?")
                          .map(([key, _]) => (key === "0" ? 0 : 1)) as Value[];
  
      if (nb_val_P.length > 0) {
        // Seulement les nœuds non défectueux doivent prendre une décision
        if (!isFaulty) {
          globalThis.StatesOfNodes[nodeId].x = nb_val_P[0];
          globalThis.StatesOfNodes[nodeId].decided = true;
        }
      } else {
        const at_least = Object.entries(countValue(messages_P))
                          .filter(([key, count]) => count >= 1 && key !== "?")
                          .map(([key, _]) => (key === "0" ? 0 : 1)) as Value[];
  
        if (at_least.length > 0) {
          // Seulement les nœuds non défectueux doivent prendre une décision
          if (!isFaulty) {
            globalThis.StatesOfNodes[nodeId].x = at_least[0];
            globalThis.StatesOfNodes[nodeId].decided = true;
          }
        } else {
          // Choisir une valeur aléatoire si aucune décision n'a été prise
          globalThis.StatesOfNodes[nodeId].x = Math.random() < 0.5 ? 0 : 1;
        }
      }
    }
  }
  

  // TODO implement this
  // this route allows retrieving the current status of the node
  // node.get("/status", (req, res) => {});
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live" );
    }
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // node.post("/message", (req, res) => {});

  // Route pour recevoir des messages
  node.post("/message", (req, res) => {
    if (globalThis.StatesOfNodes[nodeId].killed) {
      return res.status(400).send("Node is stopped");
    }

    const { type, nodeId: senderId, k, x } = req.body;

    // Si le nœud n'a pas encore décidé, on stocke le message
    if (!globalThis.StatesOfNodes[nodeId].decided) {
      storeMessage({ type, nodeId: senderId, k, x });
    }

    return res.status(200).send("Message received");
  });


  // TODO implement this
  // this route is used to start the consensus algorithm
  // node.get("/start", async (req, res) => {});

  node.get("/start", async (req, res) => {
    if (!nodesAreReady()) {
      return res.status(400).send("Nodes are not ready");
    }
  
    benOrAlgo();
    return res.status(200).send("Consensus started");
  });
  

  // TODO implement this
  // this route is used to stop the consensus algorithm
  // node.get("/stop", async (req, res) => {});

  node.get("/stop", (req, res) => {
    globalThis.StatesOfNodes[nodeId].killed = true;
    res.status(200).send("Node stopped");
  });
  

  // TODO implement this
  // get the current state of a node
  // node.get("/getState", (req, res) => {});


  node.get("/getState", (req, res) => {
    res.status(200).json(globalThis.StatesOfNodes[nodeId]);
  });
  

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}