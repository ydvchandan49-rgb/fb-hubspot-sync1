import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
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

    // 1️⃣ Fetch lead data (including email + ad/campaign IDs)
    const leadData = await fetch(
      `https://graph.facebook.com/v19.0/${leadId}?fields=field_data,ad_id,adset_id,campaign_id&access_token=${FB_ACCESS_TOKEN}`
    ).then(r => r.json());
    console.log("📦 Full Lead Data:", JSON.stringify(leadData.field_data, null, 2));


    const email = leadData.field_data?.find(f => f.name === "email")?.values?.[0];
    if (!email) {
      console.log("⚠️ No email found in lead data. Cannot update HubSpot contact.");
      return res.sendStatus(200);
    }

    const { ad_id, adset_id, campaign_id } = leadData || {};

    // 2️⃣ Get names from Facebook
    let adName = "", adsetName = "", campaignName = "";
    if (ad_id)
      adName = (await fetch(`https://graph.facebook.com/v19.0/${ad_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
    if (adset_id)
      adsetName = (await fetch(`https://graph.facebook.com/v19.0/${adset_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
    if (campaign_id)
      campaignName = (await fetch(`https://graph.facebook.com/v19.0/${campaign_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";

    // 3️⃣ Find contact by email in HubSpot
    const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: "email", operator: "EQ", value: email }],
          },
        ],
        properties: ["email"],
      }),
    }).then(r => r.json());

    const contactId = searchRes.results?.[0]?.id;

    if (!contactId) {
      console.log(`⚠️ No HubSpot contact found for ${email}`);
      return res.sendStatus(200);
    }

    // 4️⃣ Update contact
    const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          fb_campaign_name: campaignName,
          fb_adset_name: adsetName,
          fb_ad_name: adName,
          last_fb_ad_sync: new Date().toISOString(),
        },
      }),
    }).then(r => r.json());

    console.log(`✅ Updated contact ${email} (${contactId}) → ${campaignName} | ${adsetName} | ${adName}`);
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
