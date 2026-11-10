
const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_instagram_token";
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const API_VERSION = "v27.0";
const API_BASE = `https://graph.instagram.com/${API_VERSION}`;

// Start the web server immediately for Render
const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Instagram MCP running on port ${PORT}`);
});

// Home page
app.get("/", (req, res) => {
  res.send("Instagram Automation is running!");
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Instagram webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Instagram webhook receiver
app.post("/webhook", (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Instagram API helper
async function instagramGet(path, params = {}) {
  if (!ACCESS_TOKEN) {
    throw new Error("Instagram access token is missing in Render.");
  }

  const url = new URL(`${API_BASE}/${path}`);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  url.searchParams.set("access_token", ACCESS_TOKEN);

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Instagram API request failed.");
  }

  return data;
}

// Instagram profile
app.get("/instagram/profile", async (req, res) => {
  try {
    const data = await instagramGet("me", {
      fields: "id,username,account_type,media_count"
    });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Instagram media
app.get("/instagram/media", async (req, res) => {
  try {
    const data = await instagramGet("me/media", {
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: "25"
    });
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Individual media insights
app.get("/instagram/media/:mediaId/insights", async (req, res) => {
  try {
    const data = await instagramGet(
      `${encodeURIComponent(req.params.mediaId)}/insights`,
      {
        metric: "views,reach,likes,comments,saved,shares,total_interactions"
      }
    );
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Protect MCP connection
function authenticateMcp(req, res, next) {
  const key = process.env.MCP_API_KEY;

  if (!key) {
    return res.status(503).send("MCP key is not configured.");
  }

  if (req.get("authorization") !== `Bearer ${key}`) {
    return res.sendStatus(401);
  }

  next();
}

// Initialize MCP after the web server has started
async function initializeMcp() {
  try {
    const { McpServer, createMcpHandler } =
      await import("@modelcontextprotocol/server");

    const { toNodeHandler } =
      await import("@modelcontextprotocol/node");

    const { z } = await import("zod");

    const handler = createMcpHandler(() => {
      const server = new McpServer({
        name: "Instagram Automation",
        version: "1.0.0"
      });

      server.registerTool(
        "get_instagram_profile",
        {
          description: "Get Instagram Business account profile",
          inputSchema: z.object({})
        },
        async () => {
          try {
            const data = await instagramGet("me", {
              fields: "id,username,account_type,media_count"
            });

            return {
              content: [{
                type: "text",
                text: JSON.stringify(data, null, 2)
              }]
            };
          } catch (error) {
            return {
              isError: true,
              content: [{ type: "text", text: error.message }]
            };
          }
        }
      );

      server.registerTool(
        "list_instagram_media",
        {
          description: "List recent Instagram posts and Reels",
          inputSchema: z.object({})
        },
        async () => {
          try {
            const data = await instagramGet("me/media", {
              fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
              limit: "25"
            });

            return {
              content: [{
                type: "text",
                text: JSON.stringify(data, null, 2)
              }]
            };
          } catch (error) {
            return {
              isError: true,
              content: [{ type: "text", text: error.message }]
            };
          }
        }
      );

      server.registerTool(
        "get_instagram_media_insights",
        {
          description: "Get views, reach, likes, comments, saves and shares for Instagram media",
          inputSchema: z.object({
            mediaId: z.string().min(1)
          })
        },
        async ({ mediaId }) => {
          try {
            const data = await instagramGet(
              `${encodeURIComponent(mediaId)}/insights`,
              {
                metric: "views,reach,likes,comments,saved,shares,total_interactions"
              }
            );

            return {
              content: [{
                type: "text",
                text: JSON.stringify(data, null, 2)
              }]
            };
          } catch (error) {
            return {
              isError: true,
              content: [{ type: "text", text: error.message }]
            };
          }
        }
      );

      return server;
    });

    const nodeHandler = toNodeHandler(handler);

    app.all("/mcp", authenticateMcp, (req, res) => {
      void nodeHandler(req, res, req.body);
    });

    console.log("Instagram MCP endpoint initialized.");
  } catch (error) {
    console.error("MCP initialization failed:", error);
  }
}

initializeMcp();
