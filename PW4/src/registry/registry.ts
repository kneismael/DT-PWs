import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { REGISTRY_PORT } from "../config";

export type Node = { nodeId: number; pubKey: string };

export type RegisterNodeBody = {
  nodeId: number;
  pubKey: string;
};

export type GetNodeRegistryBody = {
  nodes: Node[];
};

// Launches the registry server that manages Onion Router node registration.
// @returns The Express server instance.

export async function launchRegistry() {
  const app = express();
  app.use(express.json());
  app.use(bodyParser.json());

  // In-memory storage for registered nodes
  const nodes: Node[] = [];

  // Health check endpoint to verify the server is running.

  app.get("/status", (_req: Request, res: Response) => {
    res.send("live");
  });

  // Registers a new Onion Router node by storing its ID and public key.
  
  app.post("/registerNode", (req: Request, res: Response) => {
    try {
      const { nodeId, pubKey } = req.body as RegisterNodeBody;
      if (!nodeId || !pubKey) {
        res.status(400).json({ error: "Missing nodeId or pubKey" });
        return;
      }
      
      // Prevent duplicate node registrations
      if (nodes.some((node) => node.nodeId === nodeId)) {
        res.status(409).json({ error: "Node already registered" });
        return;
      }

      nodes.push({ nodeId, pubKey });
      res.sendStatus(200);
    } catch (error) {
      console.error("Error registering node:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Retrieves the list of all registered Onion Router nodes.

  app.get("/getNodeRegistry", (_req: Request, res: Response) => {
    res.json({ nodes });
  });

  // Start the server
  const server = app.listen(REGISTRY_PORT, () => {
    console.log(`Registry is running on port ${REGISTRY_PORT}`);
  });

  return server;
}
