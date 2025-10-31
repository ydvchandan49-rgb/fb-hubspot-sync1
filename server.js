app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const leadId = changes?.value?.leadgen_id;

    if (!leadId) return res.status(400).json({ message: "No lead_id found" });

    console.log("📥 New Lead Received:", leadId);

    // 🕒 Delay 5 seconds before first attempt
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log("⏳ Waited 5 seconds before syncing to HubSpot...");

    // 🔹 Fetch lead data from Facebook
    const leadData = await fetch(
      `https://graph.facebook.com/v19.0/${leadId}?fields=field_data,ad_id,adset_id,campaign_id&access_token=${FB_ACCESS_TOKEN}`
    ).then(r => r.json());

    console.log("📦 Full Lead Data:", JSON.stringify(leadData.field_data, null, 2));

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
    let adName = "", adsetName = "", campaignName = "";

    if (ad_id)
      adName = (await fetch(`https://graph.facebook.com/v19.0/${ad_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
    if (adset_id)
      adsetName = (await fetch(`https://graph.facebook.com/v19.0/${adset_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";
    if (campaign_id)
      campaignName = (await fetch(`https://graph.facebook.com/v19.0/${campaign_id}?fields=name&access_token=${FB_ACCESS_TOKEN}`).then(r => r.json())).name || "";

    // 🔁 Retry up to 3 times to find HubSpot contact
    let contactId = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`🔎 [Attempt ${attempt}/3] Searching HubSpot contact for ${email}...`);
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

      contactId = searchRes.results?.[0]?.id;

      if (contactId) {
        console.log(`✅ Found HubSpot contact (${contactId}) on attempt ${attempt}`);
        break;
      } else if (attempt < 3) {
        console.log(`⚠️ No contact found on attempt ${attempt}, retrying in 5s...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.log(`❌ No contact found after ${attempt} attempts for ${email}`);
        console.log("🧩 HubSpot Search Response:", JSON.stringify(searchRes, null, 2));
        return res.sendStatus(200);
      }
    }

    // 🛠 Update HubSpot contact
    const updatePayload = {
      properties: {
        fb_campaign_name: campaignName,
        fb_adset_name: adsetName,
        fb_ad_name: adName,
        last_fb_ad_sync: new Date().setUTCHours(0, 0, 0, 0),
      },
    };

    const updateResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatePayload),
      }
    );

    const updateResult = await updateResponse.json();

    if (!updateResponse.ok) {
      console.error("❌ HubSpot Update Error:", JSON.stringify(updateResult, null, 2));
    } else {
      console.log(`✅ Updated contact ${email} (${contactId})`);
      console.log(`📊 FB → ${campaignName} | ${adsetName} | ${adName}`);
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
