
const express = require("express");

const app = express();
app.use(express.json());

const VERIFY_TOKEN =
  process.env.VERIFY_TOKEN || "my_instagram_token";

const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const API_VERSION = "v27.0";
const API_BASE =
  `https://graph.instagram.com/${API_VERSION}`;

app.get("/", (req, res) => {
  res.send("Instagram Automation is running!");
});

// Existing webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// Existing webhook receiver
app.post("/webhook", (req, res) => {
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Common Instagram API request
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
    throw new Error(
      data.error?.message || "Instagram API request failed."
    );
  }

  return data;
}

// Check connected Instagram account
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

// Get recent Instagram posts and Reels
app.get("/instagram/media", async (req, res) => {
  try {
    const data = await instagramGet("me/media", {
      fields:
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: "25"
    });

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get insights for an individual Reel or post
app.get("/instagram/media/:mediaId/insights", async (req, res) => {
  try {
    const data = await instagramGet(
      `${encodeURIComponent(req.params.mediaId)}/insights`,
      {
        metric:
          "views,reach,likes,comments,saved,shares,total_interactions"
      }
    );

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
