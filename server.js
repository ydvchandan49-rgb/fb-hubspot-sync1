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

    // 🕒 Delay 5 seconds to allow HubSpot auto-sync contact creation
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log("⏳ Waited 5 seconds before syncing to HubSpot...");

    // 1️⃣ Fetch lead data (including email + ad/campaign IDs)
    const leadData = await fetch(
      `https://graph.facebook.com/v19.0/${leadId}?fields=field_data,ad_id,adset_id,campaign_id&access_token=${FB_ACCESS_TOKEN}`
    ).then(r => r.json());
    console.log("📦 Full Lead Data:", JSON.stringify(leadData.field_data, null, 2));

    // 2️⃣ Try to get email field (case-insensitive, flexible)
    const emailField = leadData.field_data?.find(f =>
      ["email", "e-mail", "work_email", "official_email"].some(key =>
        f.name.toLowerCase().includes(key)
      )
    );
    const email = emailField?.values?.[0];

    if (!email) {
      console.log("⚠️ No email found in lead data. Cannot update HubSpot contact.");
      return res.sendStatus(200);
    }

    const { ad_id, adset_id, campaign_id } = leadData || {};

    // 3️⃣ Get names from Facebook
    let adName = "", adsetName = "", campaignName = "";
    if (ad_id)
      adName = (await fetch(`https://graph.facebook.com/v19.0/${ad_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
    if (adset_id)
      adsetName = (await fetch(`https://graph.facebook.com/v19.0/${adset_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
    if (campaign_id)
      campaignName = (await fetch(`https://graph.facebook.com/v19.0/${campaign_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";

    // 4️⃣ Find contact by email in HubSpot
    console.log("🔎 Searching HubSpot contact for email:", email);
    const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "email", operator: "CONTAINS_TOKEN", value: email.toLowerCase() }
            ],
          },
        ],
        properties: ["email"],
      }),
    }).then(r => r.json());

    const contactId = searchRes.results?.[0]?.id;

    if (!contactId) {
      console.log(`⚠️ No HubSpot contact found for ${email}`);
      console.log("🧩 HubSpot Search Response:", JSON.stringify(searchRes, null, 2));
      return res.sendStatus(200);
    }

    // 5️⃣ Update contact with error capture
    const updatePayload = {
      properties: {
        fb_campaign_name: campaignName,
        fb_adset_name: adsetName,
        fb_ad_name: adName,
        last_fb_ad_sync: new Date().setUTCHours(0, 0, 0, 0),

      },
    };

    const updateResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatePayload),
    });

    const updateResult = await updateResponse.json();

    // 🧠 Log both success and errors clearly
    if (!updateResponse.ok) {
      console.error("❌ HubSpot Update Error:", JSON.stringify(updateResult, null, 2));
    } else {
      console.log(`✅ Updated contact ${email} (${contactId})`);
      console.log(`📊 FB Data → Campaign: ${campaignName} | Adset: ${adsetName} | Ad: ${adName}`);
      console.log("📤 HubSpot Response:", JSON.stringify(updateResult, null, 2));
    }

    res.status(200).json({
      status: updateResponse.ok ? "success" : "failed",
      lead_id: leadId,
      hubspot_status: updateResponse.status,
      hubspot_result: updateResult,
    });

  } catch (err) {
    console.error("❌ Server Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
