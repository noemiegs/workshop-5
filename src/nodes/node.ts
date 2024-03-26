// Importing necessary modules. The body-parser module is used for parsing incoming request bodies,
// express for creating the server, and other configurations and types from external files.
import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";

// Defining the type for the state of a node including its operational status, value, decision status, and round number.
type NodeState = {
  killed: boolean;
  x: 0 | 1 | "?" | null;
  decided: boolean | null;
  k: number | null;
};

// The main function for a node in the consensus algorithm, handling initialization and communication.
export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // function to check if all nodes are ready
  setNodeIsReady: (index: number) => void // function to set this node as ready
) {
  // Setting up the express application and middleware for JSON body parsing.
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Variables to store proposals and votes from other nodes.
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Endpoint to check the status of the node. It returns "faulty" for faulty nodes and "live" for operational nodes.
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Initializes the current state of the node.
  let currentState: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0,
  };

  // Endpoint to start the consensus algorithm. It waits until all nodes are ready and then begins the consensus process.
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) { await delay(100);} // Delaying until all nodes are ready
    if (!isFaulty) {
      // Initiating the consensus round for non-faulty nodes
      currentState.k = 1;
      currentState.x = initialValue;
      currentState.decided = false;
      // Broadcasting the initial value to all nodes
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            k: currentState.k,
            x: currentState.x,
            type: "2P",
          }),
        });
      }
    } else {
      // Setting the state for faulty nodes
      currentState.decided = null;
      currentState.x = null;
      currentState.k = null;
    }
    res.status(200).send("success");
  });

  // Endpoint for receiving messages from other nodes. This includes processing of proposals and votes.
  node.post("/message", async (req, res) => {
    let { k, x, type } = req.body;
    if (!currentState.killed && !isFaulty) {
      if (type == "Propose") {
        // Handling a proposal message
        if (!proposals.has(k)) proposals.set(k, []);
        proposals.get(k)!.push(x);
        const proposal = proposals.get(k)!;
        // If enough proposals have been received, decide on a value and broadcast it
        if (proposal.length >= N - F) {
          const CN = proposal.filter((x) => x == 0).length;
          const CY = proposal.filter((x) => x == 1).length;
          x = CN > N / 2 ? 0 : CY > N / 2 ? 1 : "?";
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ k, x, type: "2V" }),
            });
          }
        }
      } else if (type == "Vote") {
        // Handling a vote message
        if (!votes.has(k)) votes.set(k, []);
        votes.get(k)!.push(x);
        const vote = votes.get(k)!;
        // When enough votes are collected, the node makes a decision based on the majority or moves to the next round.
        if (vote.length >= N - F) {
          const CN = vote.filter((x) => x == 0).length;
          const CY = vote.filter((x) => x == 1).length;
          if (CN >= F + 1) {
            // If a majority decides 0, the node decides on 0.
            currentState.x = 0;
            currentState.decided = true;
          } else if (CY >= F + 1) {
            // If a majority decides 1, the node decides on 1.
            currentState.x = 1;
            currentState.decided = true;
          } else {
            // If there is no clear majority, the node chooses a value based on the majority of proposals received,
            // or randomly if the proposals are evenly split, and proceeds to the next round.
            currentState.x = CN + CY > 0 && CN > CY ? 0 : CN + CY > 0 && CN < CY ? 1 : Math.random() > 0.5 ? 0 : 1;
            currentState.k = k + 1;
            // Broadcasting the new value for the next round.
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ k: currentState.k, x: currentState.x, type: "2P" }),
              });
            }
          }
        }
      }
    }
    res.status(200).send("success");
  });
  
  // TODO implement this
  // this route is used to stop the consensus algorithm
  
  // Endpoint to stop the consensus algorithm and reset the node's state.
  node.get("/stop", async (req, res) => {
    currentState.killed = true;
    currentState.x = null;
    currentState.decided = null;
    currentState.k = 0;
    res.send("Node stopped");
  });

// Endpoint to retrieve the current state of the node. It returns different information based on whether the node is faulty or not.
  node.get("/getState", (req, res) => {
    if (isFaulty) {
      // For faulty nodes, the state reflects an inability to decide or participate.
      res.send({
        killed: currentState.killed,
        x: null,
        decided: null,
        k: null,
      });
    } else {
      // For non-faulty nodes, the current state including the decision and round number is returned.
      res.send(currentState);
    }
  });

  // Starting the server and marking the node as ready. This listens on a port unique to the node, based on its ID.
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });

  // Returning the server for the node.
  return server;
}
