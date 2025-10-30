import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || "dummy_fb_token";
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN || "dummy_hs_token";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify-token-123";

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const leadId = changes?.value?.leadgen_id;

    if (!leadId) return res.status(400).json({ message: "No lead_id found" });

    console.log("📥 New Lead Received:", leadId);

    const leadData = await fetch(
      `https://graph.facebook.com/v19.0/${leadId}?fields=ad_id,adset_id,campaign_id&access_token=${FB_ACCESS_TOKEN}`
    ).then(r => r.json()).catch(() => ({}));

    const { ad_id, adset_id, campaign_id } = leadData || {};

    let adName = "", adsetName = "", campaignName = "";
    try {
      if (ad_id)
        adName = (await fetch(`https://graph.facebook.com/v19.0/${ad_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
      if (adset_id)
        adsetName = (await fetch(`https://graph.facebook.com/v19.0/${adset_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
      if (campaign_id)
        campaignName = (await fetch(`https://graph.facebook.com/v19.0/${campaign_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
    } catch (err) {
      console.warn("⚠️ FB fetch skipped (dummy token mode).");
    }

    const contactId = "dummy-contact-id";

    if (HUBSPOT_TOKEN === "dummy_hs_token") {
      console.log(`🧪 Dummy update: ${campaignName} | ${adsetName} | ${adName}`);
    } else {
      await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          properties: {
            fb_campaign_name: campaignName,
            fb_adset_name: adsetName,
            fb_ad_name: adName,
            last_fb_ad_sync: new Date().toISOString()
          }
        })
      });
    }

    console.log(`✅ Processed Lead: ${leadId}`);
    res.status(200).json({
      status: "success",
      lead_id: leadId,
      fb_campaign_name: campaignName,
      fb_adset_name: adsetName,
      fb_ad_name: adName
    });

  } catch (err) {
    console.error("❌ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
