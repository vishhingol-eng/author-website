// ============================================================
// Cloudflare Worker — Subscribe + Mentor Inquiry Proxy
// Handles two things, both authenticated server-side via your
// encrypted BREVO_API_KEY secret — never exposed in public code:
//
// 1. Newsletter subscribe (adds contact to your Brevo list)
// 2. Mentor inquiry (emails the submission directly to you
//    + sends a confirmation back to the person)
// ============================================================

export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://vishalhingolauthor.com";
    // Set this to your real inbox - where mentor inquiries should land
    const YOUR_INBOX_EMAIL = "vishhingol@gmail.com";
    const YOUR_NAME = "Vishal Hingol";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const BREVO_API_KEY = env.BREVO_API_KEY;
    const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN };

    try {
      const body = await request.json();

      // ============================================================
      // MENTOR INQUIRY — emails the submission to Vishal via Brevo
      // + sends confirmation email back to the person
      // ============================================================
      if (body.type === "mentor_inquiry") {
        const { name, email, phone, message, book } = body;

        if (!name || !email || !message) {
          return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 400, headers: cors });
        }

        const emailHtml = `
          <h2>New Mentorship Inquiry</h2>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>WhatsApp:</strong> ${escapeHtml(phone || "Not provided")}</p>
          <p><strong>Book that brought them here:</strong> ${escapeHtml(book || "Not specified")}</p>
          <p><strong>Message:</strong></p>
          <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
          <hr>
          <p style="color:#888;font-size:12px">Sent from the mentorship form on vishalhingolauthor.com</p>
        `;

        // Email 1: Notify Vishal
        const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": BREVO_API_KEY,
          },
          body: JSON.stringify({
            sender: { name: "Website Mentorship Form", email: "contact@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            replyTo: { email: email, name: name },
            subject: `New Mentorship Inquiry from ${name}`,
            htmlContent: emailHtml,
          }),
        });

        if (brevoRes.ok) {
          // Email 2: Send confirmation back to the person
          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-key": BREVO_API_KEY,
            },
            body: JSON.stringify({
              sender: { name: "Vishal Hingol", email: "contact@vishalhingolauthor.com" },
              to: [{ email: email, name: name || "Reader" }],
              subject: "Got it — your free intro call request is received",
              htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.7;">
                  <p>Hi${name ? " " + escapeHtml(name) : ""},</p>

                  <p>Thank you for reaching out. I have received your request for a free intro call.</p>

                  <p>I read every message personally and will get back to you within 2–3 days to schedule our conversation. In the meantime, here is what to expect:</p>

                  <ul>
                    <li>A 20-minute video call, no pitch, no pressure</li>
                    <li>We talk through where you are stuck and what is actually possible</li>
                    <li>If it is not a fit for either of us, that is a completely fine outcome</li>
                  </ul>

                  <p>If you have not read any of my books yet and want to get a feel for how I think, here is a free lost chapter from Zara and the Divine Signal:</p>

                  <p style="text-align: center; margin: 24px 0;">
                    <a href="https://vishalhingolauthor.com/lost-chapter.html" style="display: inline-block; background: #E8BB6B; color: #070A18; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px;">Read The Night Before</a>
                  </p>

                  <p>Looking forward to our conversation.</p>

                  <p>
                    Vishal Hingol<br>
                    <a href="https://vishalhingolauthor.com" style="color: #E8BB6B;">vishalhingolauthor.com</a>
                  </p>
                </div>
              `,
            }),
          }).catch(() => {}); // Don't block if confirmation fails

          return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
        }

        const errBody = await brevoRes.text();
        return new Response(JSON.stringify({ success: false, error: "Could not send. Please email directly.", debug: errBody }), { status: 500, headers: cors });
      }

      // ============================================================
      // NEWSLETTER SUBSCRIBE — existing behaviour, unchanged
      // ============================================================
      const { email } = body;
      if (!email || !email.includes("@")) {
        return new Response(JSON.stringify({ error: "Invalid email" }), { status: 400, headers: cors });
      }

      const BREVO_LIST_ID = 3;
      const brevoRes = await fetch("https://api.brevo.com/v3/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
        body: JSON.stringify({ email, listIds: [BREVO_LIST_ID], updateEnabled: true }),
      });

      if (brevoRes.ok || brevoRes.status === 204) {
        return new Response(JSON.stringify({ success: true, message: "You're subscribed! Watch your inbox." }), { status: 200, headers: cors });
      }

      const errData = await brevoRes.json().catch(() => ({}));
      if (errData.code === "duplicate_parameter") {
        return new Response(JSON.stringify({ success: true, message: "You're already subscribed!" }), { status: 200, headers: cors });
      }

      return new Response(JSON.stringify({ success: false, error: "Something went wrong. Please try again." }), { status: 500, headers: cors });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: "Server error. Please try again." }), { status: 500, headers: cors });
    }
  },
};

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
