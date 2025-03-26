import express from "express";
import bodyParser from "body-parser";
import { BASE_USER_PORT, REGISTRY_PORT, BASE_ONION_ROUTER_PORT } from "../config";
import { createRandomSymmetricKey, exportSymKey, rsaEncrypt, symEncrypt } from "../crypto";
import { GetNodeRegistryBody, Node } from "../registry/registry";

export type SendMessageBody = {
  message: string;
  destinationUserId: number;
};

// Creates and starts a server to simulate an Onion network user.
// @param userId - The unique identifier for the user.
// @returns The created HTTP server instance.
 
export async function user(userId: number) {
  const userApp = express();
  userApp.use(express.json());
  userApp.use(bodyParser.json());

  // State variables to track message and circuit status
  let lastReceivedMessage: string | null = null;
  let lastSentMessage: string | null = null;
  let lastCircuit: number[] = [];

  // Health check endpoint
  userApp.get("/status", (_, res) => res.send("live"));

  // Endpoint to receive a message from the final node in the circuit.
  userApp.post("/message", (req, res) => {
    lastReceivedMessage = req.body.message;
    res.status(200).send("success");
  });

  // Endpoints to retrieve message and circuit status
  userApp.get("/getLastReceivedMessage", (_, res) => res.json({ result: lastReceivedMessage }));
  userApp.get("/getLastSentMessage", (_, res) => res.json({ result: lastSentMessage }));
  userApp.get("/getLastCircuit", (_, res) => res.json({ result: lastCircuit }));

  // Main endpoint to send a message through the Onion network.
   
  userApp.post("/sendMessage", async (req, res) => {
    const { message, destinationUserId } = req.body;
    lastSentMessage = message;

    try {
      // Retrieve available nodes from the registry
      const response = await fetch(`http://localhost:${REGISTRY_PORT}/getNodeRegistry`);
      const { nodes } = (await response.json()) as GetNodeRegistryBody;

      // Select three random nodes to form the Onion circuit
      const circuit = getRandomNodes(nodes, 3);
      lastCircuit = circuit.map(node => node.nodeId);

      const [entryNode, middleNode, exitNode] = circuit;
      const [entryKey, middleKey, exitKey] = await Promise.all([
        createRandomSymmetricKey(),
        createRandomSymmetricKey(),
        createRandomSymmetricKey()
      ]);

      // Construct the layered encryption from innermost to outermost
      let data = message;
      const layers = [
        { node: exitNode, key: exitKey, nextPort: BASE_USER_PORT + destinationUserId },
        { node: middleNode, key: middleKey, nextPort: BASE_ONION_ROUTER_PORT + exitNode.nodeId },
        { node: entryNode, key: entryKey, nextPort: BASE_ONION_ROUTER_PORT + middleNode.nodeId }
      ];

      for (const { node, key, nextPort } of layers) {
        const destination = `${nextPort}`.padStart(10, "0");
        const encryptedLayer = await symEncrypt(key, destination + data);
        const encryptedKey = await rsaEncrypt(await exportSymKey(key), node.pubKey);
        data = encryptedKey + encryptedLayer;
      }

      // Send the encrypted message to the entry node
      await fetch(`http://localhost:${BASE_ONION_ROUTER_PORT + entryNode.nodeId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: data })
      });

      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  //Utility function to select a random subset of nodes.
  // @param nodes - List of available nodes, @param count - Number of nodes to select.
  // @returns An array of randomly selected nodes.
  
  function getRandomNodes(nodes: Node[], count: number): Node[] {
    return nodes.sort(() => Math.random() - 0.5).slice(0, count);
  }

  // Start the user server
  const server = userApp.listen(BASE_USER_PORT + userId, () => {
    console.log(`User ${userId} listening on port ${BASE_USER_PORT + userId}`);
  });

  return server;
}