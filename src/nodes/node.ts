import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";

// Type definition for the state of a node within the consensus algorithm
type NodeState = {
  killed: boolean;
  x: 0 | 1 | "?" | null;
  decided: boolean | null;
  k: number | null;
};

// Asynchronous function that defines the behavior of a node in the consensus network
export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  // Creating an express application for the node
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Initializing storage for proposals and votes
  let votes: Map<number, Value[]> = new Map();
  let proposals: Map<number, Value[]> = new Map();

  // Initial state of the node
  let current_state: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0,
  };
    // Endpoint to check the status of the node
    node.get("/status", (req, res) => {
      // Respond with 'faulty' status for faulty nodes, and 'live' for others
      if (isFaulty) {res.status(500).send("faulty");} 
      else {res.status(200).send("live");}
    });

// Endpoint to start the consensus algorithm
  node.get("/start", async (req, res) => {
    // Wait until all nodes are ready before starting
    while (!nodesAreReady()) { await delay(100);}
    // Initialize the state for starting the consensus process
    if (!isFaulty) {
      current_state.k = 1;
      current_state.x = initialValue;
      current_state.decided = false;
      // Broadcast the initial value to all nodes
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",},
          body: JSON.stringify({
            k: current_state.k,
            x: current_state.x,
            type: "propose",}),
        });
      }
    } else {
      // Set the state to undefined for faulty nodes
      current_state.decided = null;
      current_state.x = null;
      current_state.k = null;
    }
    res.status(200).send("success");
  });

  // Endpoint to receive messages from other nodes
  node.post("/message", async (req, res) => {
    let { k, x, type } = req.body;// Destructure the message content
    if (!current_state.killed && !isFaulty) { // Process messages if node is active and not faulty
      // Handle proposal messages
      if (type == "propose") {
        if (!proposals.has(k)) proposals.set(k, []);
        proposals.get(k)!.push(x);
        const proposal = proposals.get(k)!;
        // If enough proposals are received, decide on a value and broadcast it
        if (proposal.length >= N - F) {
          const CN = proposal.filter((x) => x == 0).length;
          const CY = proposal.filter((x) => x == 1).length;
          x = CN > N / 2 ? 0 : CY > N / 2 ? 1 : "?";
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ k, x, type: "vote" }),
            });
          }
        }
      } else if (type == "vote") {
        // Handle vote messages
        if (!votes.has(k)) votes.set(k, []);
        votes.get(k)!.push(x);
        const vote = votes.get(k)!;
        // If enough votes are received, make a decision based on the majority
        if (vote.length >= N - F) {
          const CN = vote.filter((x) => x == 0).length;
          const CY = vote.filter((x) => x == 1).length;
          if (CN >= F + 1) {
            // Decide on 0 if it has a majority
            current_state.x = 0;
            current_state.decided = true;
          } else if (CY >= F + 1) {
            // Decide on 1 if it has a majority
            current_state.x = 1;
            current_state.decided = true;
          } else {
            // If there's no clear majority, choose based on the majority or randomly if tied
            current_state.x = CN + CY > 0 && CN > CY ? 0 : CN + CY > 0 && CN < CY ? 1 : Math.random() > 0.5 ? 0 : 1;
            // Move to the next round
            current_state.k = k + 1;
            // Broadcast the decision for the next round to all nodes
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ k: current_state.k, x: current_state.x, type: "propose" }),
              });
            }
          }
        }
      }
    }
    // Respond to the sender indicating successful receipt and processing of the message
    res.status(200).send("success");
  });

    // Endpoint to stop the consensus algorithm and reset the node's state
    node.get("/stop", async (req, res) => {
      current_state.killed = true;
      current_state.x = null;
      current_state.decided = null;
      current_state.k = 0;
      res.send("Node stopped");
    });
  

    // Endpoint to get the current state of the node
    node.get("/getState", (req, res) => {
      // For faulty nodes, return a state indicating they cannot participate or decide
      if (isFaulty) {
        res.send({
          killed: current_state.killed,
          x: null,
          decided: null,
          k: null,
        });
      } else {
        res.send(current_state);
      }
    });



  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });

  return server;
}
