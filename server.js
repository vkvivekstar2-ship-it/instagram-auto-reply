
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "my_instagram_token";
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_CONFIG_ID = "1806323053624613";

const IG_USER_ID = "17841452153492157";

const API_VERSION = "v27.0";
const API_BASE = `https://graph.facebook.com/${API_VERSION}`;

const REDIRECT_URI =
  "https://instagram-auto-reply-96nd.onrender.com/auth/instagram/callback";

let oauthState = null;

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Instagram Automation running on port ${PORT}`);
});

// Home
app.get("/", (req, res) => {
  res.send("Instagram Automation is running!");
});

// Health
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Start Meta login
app.get("/auth/instagram", (req, res) => {
  if (!META_APP_ID || !META_APP_SECRET) {
    return res.status(500).send("Meta credentials are missing.");
  }

  oauthState = crypto.randomBytes(32).toString("hex");

  const loginUrl = new URL("https://www.facebook.com/dialog/oauth");

  loginUrl.searchParams.set("client_id", META_APP_ID);
  loginUrl.searchParams.set("config_id", META_CONFIG_ID);
  loginUrl.searchParams.set("display", "popup");
  loginUrl.searchParams.set("override_default_response_type", "true");
  loginUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  loginUrl.searchParams.set("response_type", "code");
  loginUrl.searchParams.set("state", oauthState);
  loginUrl.searchParams.set("prompt", "login");

  res.redirect(loginUrl.toString());
});

// Meta login callback
app.get("/auth/instagram/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send("Meta login was cancelled or denied.");
    }

    if (!code || !state || state !== oauthState) {
      return res.status(400).send("Invalid login state. Please try again.");
    }

    oauthState = null;

    const tokenUrl = new URL(`${API_BASE}/oauth/access_token`);

    tokenUrl.searchParams.set("client_id", META_APP_ID);
    tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
    tokenUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    tokenUrl.searchParams.set("code", code);

    const response = await fetch(tokenUrl);
    const data = await response.json();

    if (!response.ok || !data.access_token) {
      console.error("Meta token exchange failed:", data.error?.message);
      return res.status(400).send("Meta could not issue an access token.");
    }

    const longUrl = new URL(`${API_BASE}/oauth/access_token`);

    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", META_APP_ID);
    longUrl.searchParams.set("client_secret", META_APP_SECRET);
    longUrl.searchParams.set("fb_exchange_token", data.access_token);

    const longResponse = await fetch(longUrl);
    const longData = await longResponse.json();

    if (!longResponse.ok || !longData.access_token) {
      console.error("Token exchange failed:", longData.error?.message);
      return res.status(400).send("Long-lived token exchange failed.");
    }

    res.json({
      message: "Login successful. Keep this token private.",
      access_token: longData.access_token,
      token_type: longData.token_type,
      expires_in: longData.expires_in
    });

  } catch (error) {
    console.error("Login callback failed:", error.message);
    res.status(500).send("Instagram login failed.");
  }
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
    const data = await instagramGet(IG_USER_ID, {
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
    const data = await instagramGet(`${IG_USER_ID}/media`, {
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: "25"
    });

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Media insights
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

// Initialize MCP
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
            const data = await instagramGet(IG_USER_ID, {
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
            const data = await instagramGet(`${IG_USER_ID}/media`, {
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
          description: "Get Instagram media views, reach, likes, comments, saves and shares",
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
