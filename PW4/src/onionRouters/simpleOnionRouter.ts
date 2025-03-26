import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import crypto from "crypto";
import http from "http";
import { rsaDecrypt, importSymKey, symDecrypt, importPrvKey } from "../crypto";


export async function simpleOnionRouter(nodeId: number) {
  // Initialize the Express application
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  // Variables to store message states
  let lastEncryptedMessage: string | null = null;
  let lastDecryptedMessage: string | null = null;
  let lastMessageDestination: number | null = null;

  // Generate RSA key pairs for asymmetric encryption
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  // Convert keys to Base64 for easy transmission
  const publicKeyBase64 = Buffer.from(
    publicKey.export({ type: "spki", format: "der" })
  ).toString("base64");
  const privateKeyBase64 = Buffer.from(
    privateKey.export({ type: "pkcs8", format: "der" })
  ).toString("base64");
  const privateCryptoKey = await importPrvKey(privateKeyBase64);

  // Register the node with the central registry
  const registrationData = JSON.stringify({ nodeId, pubKey: publicKeyBase64 });
  const request = http.request(
    {
      hostname: "localhost",
      port: REGISTRY_PORT,
      path: "/registerNode",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(registrationData),
      },
    },
    (res) => {
      if (res.statusCode !== 200) {
        console.error("Registration failed with status code:", res.statusCode);
      }
    }
  );
  request.on("error", (err) => console.error("Registration error:", err));
  request.write(registrationData);
  request.end();

  // Endpoint to check if the server is running
  onionRouter.get("/status", (req, res) => res.send("live"));

  // Endpoints to retrieve message states
  onionRouter.get("/getLastReceivedEncryptedMessage", (req, res) => {
    res.json({ result: lastEncryptedMessage });
  });

  onionRouter.get("/getLastReceivedDecryptedMessage", (req, res) => {
    res.json({ result: lastDecryptedMessage });
  });

  onionRouter.get("/getLastMessageDestination", (req, res) => {
    res.json({ result: lastMessageDestination });
  });

  onionRouter.get("/getPrivateKey", (req, res) => {
    res.json({ result: privateKeyBase64 });
  });

  // Main endpoint to receive and process an encrypted message.
  // Decrypts an Onion layer and forwards the message to the next node.
  onionRouter.post("/message", async (req, res) => {
    try {
      const { message } = req.body;
      lastEncryptedMessage = message;

      const encryptedKey = message.substring(0, 344);
      const encryptedContent = message.substring(344);
      const symKeyBase64 = await rsaDecrypt(encryptedKey, privateCryptoKey);
      const symKey = await importSymKey(symKeyBase64);
      const decryptedContent = await symDecrypt(symKeyBase64, encryptedContent);
      const nextDestination = parseInt(decryptedContent.substring(0, 10), 10);
      const nextMessage = decryptedContent.substring(10);

      lastDecryptedMessage = nextMessage;
      lastMessageDestination = nextDestination;

      await fetch(`http://localhost:${nextDestination}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: nextMessage }),
      });

      res.status(200).send("success");
    } catch (error) {
      console.error("Node processing error:", error);
      res.status(500).send("error");
    }
  });

  // Start the server
  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(
      `Onion Router ${nodeId} listening on port ${BASE_ONION_ROUTER_PORT + nodeId}`
    );
  });

  return server;
}