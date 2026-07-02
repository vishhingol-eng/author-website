// ============================================================
// Cloudflare Worker — Subscribe + Mentor Inquiry + Agreement + Order Proxy
// Handles four things, all authenticated server-side via your
// encrypted BREVO_API_KEY secret — never exposed in public code:
//
// 1. Newsletter subscribe (adds contact to your Brevo list)
// 2. Mentor inquiry (emails the submission directly to you
//    + sends a confirmation back to the person)
// 3. Client agreement (sends signed copy to both parties)
// 4. Product order (emails the order details to you
//    + sends an order confirmation back to the customer)
//
// IMPORTANT: Product orders use a completely separate email
// flow from newsletter subscribe. Ordering a product does NOT
// add anyone to the newsletter list, and newsletter subscribers
// never receive order-related emails. These are intentionally
// isolated so customer and subscriber communications never mix.
// ============================================================

export default {
  async fetch(request, env) {
    const ALLOWED_ORIGIN = "https://vishalhingolauthor.com";
    // Set this to your real inbox - where mentor inquiries and orders should land
    const YOUR_INBOX_EMAIL = "vishhingol@gmail.com";
    const YOUR_NAME = "Vishal Hingol";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Credentials": "true",
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
    const cors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN, "Access-Control-Allow-Credentials": "true" };

    // ============================================================
    // PAYPAL WEBHOOK — arrives with a PayPal-Transmission-Id header.
    // PayPal sends this directly server-to-server on payment success,
    // refund, or dispute — completely independent of the browser.
    // We verify the webhook ID against PayPal's API before trusting
    // the payload, then send confirmation emails on PAYMENT.CAPTURE.COMPLETED.
    // ============================================================
    if (request.headers.get("paypal-transmission-id")) {
      const rawBody = await request.text();
      let ppBody;
      try { ppBody = JSON.parse(rawBody); } catch(e) {
        return new Response("Bad JSON", { status: 400 });
      }

      // Verify signature with PayPal's webhook verification API
      const transmissionId  = request.headers.get("paypal-transmission-id");
      const transmissionTime = request.headers.get("paypal-transmission-time");
      const certUrl         = request.headers.get("paypal-cert-url");
      const authAlgo        = request.headers.get("paypal-auth-algo");
      const transmissionSig = request.headers.get("paypal-transmission-sig");
      const webhookId       = env.PAYPAL_WEBHOOK_ID; // Set this in Cloudflare Worker secrets

      // Only verify if the secret is configured — if not yet set up, log and pass through
      if (webhookId) {
        const verifyRes = await fetch("https://api-m.paypal.com/v1/notifications/verify-webhook-signature", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Basic " + btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET),
          },
          body: JSON.stringify({
            transmission_id:   transmissionId,
            transmission_time: transmissionTime,
            cert_url:          certUrl,
            auth_algo:         authAlgo,
            transmission_sig:  transmissionSig,
            webhook_id:        webhookId,
            webhook_event:     ppBody,
          }),
        });
        const verifyData = await verifyRes.json().catch(() => ({}));
        if (verifyData.verification_status !== "SUCCESS") {
          return new Response("Webhook verification failed", { status: 401 });
        }
      }

      const eventType = ppBody.event_type || "";

      // Only act on successful payment capture
      if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
        const resource    = ppBody.resource || {};
        const amount      = resource.amount?.value || "unknown";
        const currency    = resource.amount?.currency_code || "USD";
        const captureId   = resource.id || "N/A";
        const payerEmail  = resource.payer?.email_address || ppBody.resource?.supplementary_data?.related_ids?.order_id || "Unknown";
        const payerName   = [resource.payer?.name?.given_name, resource.payer?.name?.surname].filter(Boolean).join(" ") || "Customer";
        const orderId     = resource.supplementary_data?.related_ids?.order_id || captureId;

        // Determine plan from amount
        const amountNum = parseFloat(amount);
        const planLabel = amountNum <= 30 ? "Single Session — $29" : "Monthly Mentorship — $99/month";

        // Notify Vishal — real confirmed payment
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Mentorship Payments", email: "contact@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            subject: `✅ PayPal Payment Confirmed — ${escapeHtml(payerName)} · ${currency} ${amount}`,
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                <div style="background:#070A18;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center">
                  <h1 style="color:#E8BB6B;font-size:20px;margin:0;font-weight:400">✅ PayPal Payment Confirmed</h1>
                  <p style="color:#7DE6FF;font-size:13px;margin:6px 0 0">Verified by PayPal webhook — this is a real payment</p>
                </div>
                <div style="background:#f9f9f9;padding:24px 32px;border:1px solid #e0e0e0">
                  <p><strong>Customer Name:</strong> ${escapeHtml(payerName)}</p>
                  <p><strong>Customer Email:</strong> ${escapeHtml(payerEmail)}</p>
                  <p><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}</p>
                  <p><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
                  <p><strong>PayPal Capture ID:</strong> ${escapeHtml(captureId)}</p>
                  <p><strong>PayPal Order ID:</strong> ${escapeHtml(orderId)}</p>
                  <hr style="border:none;border-top:1px solid #e0e0e0;margin:18px 0">
                  <p style="font-size:12px;color:#888">This email was triggered by PayPal's payment webhook — payment is confirmed and funds are captured. Reply to this email to contact the customer, then schedule their session within 2–3 business days.</p>
                </div>
              </div>
            `,
          }),
        }).catch(() => {});

        // Send confirmation to customer if we have their email
        if (payerEmail && payerEmail !== "Unknown") {
          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
            body: JSON.stringify({
              sender: { name: "Vishal Hingol", email: "contact@vishalhingolauthor.com" },
              to: [{ email: payerEmail, name: payerName }],
              subject: "Your mentorship session is confirmed ✦",
              htmlContent: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                  <div style="background:#070A18;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center">
                    <h1 style="color:#E8BB6B;font-size:22px;margin:0;font-weight:400">Payment confirmed ✦</h1>
                    <p style="color:#9AA1C7;font-size:14px;margin:8px 0 0">Your ${escapeHtml(planLabel)} with Vishal Hingol is booked.</p>
                  </div>
                  <div style="background:#f9f9f9;padding:24px 32px;border:1px solid #e0e0e0">
                    <p>Hi ${escapeHtml(payerName)},</p>
                    <p>Your payment of <strong>${escapeHtml(currency)} ${escapeHtml(amount)}</strong> has been received and confirmed. Here is what happens next:</p>
                    <ul>
                      <li>Vishal will personally reach out within <strong>2–3 business days</strong> to schedule your session</li>
                      <li>Sessions are via video call — Zoom, Google Meet, or WhatsApp Video</li>
                      <li>Please <a href="https://vishalhingolauthor.com/agreement.html" style="color:#E8BB6B">sign the Client Agreement</a> before your first session</li>
                    </ul>
                    <div style="background:#070A18;border-radius:10px;padding:16px 20px;margin:18px 0">
                      <p style="color:#9AA1C7;font-size:12px;margin:0 0 6px">Payment receipt</p>
                      <p style="color:#F4EEE2;margin:3px 0"><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
                      <p style="color:#F4EEE2;margin:3px 0"><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}</p>
                      <p style="color:#F4EEE2;margin:3px 0"><strong>Reference:</strong> ${escapeHtml(captureId)}</p>
                    </div>
                    <p>If you have questions before your session, reply to this email.</p>
                    <p>Vishal Hingol<br><a href="https://vishalhingolauthor.com" style="color:#E8BB6B">vishalhingolauthor.com</a></p>
                    <hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0">
                    <p style="font-size:11px;color:#aaa">Refund policy: <a href="https://vishalhingolauthor.com/policies.html" style="color:#E8BB6B">vishalhingolauthor.com/policies.html</a></p>
                  </div>
                </div>
              `,
            }),
          }).catch(() => {});
        }
      }

      // Always return 200 to PayPal — they retry if they get anything else
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // ============================================================
    // RAZORPAY WEBHOOK — arrives with x-razorpay-signature header.
    // Razorpay signs the payload with your webhook secret using
    // HMAC-SHA256. We verify the signature before trusting the event,
    // then send confirmation emails on payment.captured.
    // ============================================================
    if (request.headers.get("x-razorpay-signature")) {
      const rawBody = await request.text();
      const razorpaySignature = request.headers.get("x-razorpay-signature");
      const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET; // Set in Cloudflare Worker secrets

      if (webhookSecret) {
        // Verify HMAC-SHA256 signature
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw", encoder.encode(webhookSecret),
          { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
        );
        const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
        const expectedSignature = Array.from(new Uint8Array(signatureBytes))
          .map(b => b.toString(16).padStart(2, "0")).join("");

        if (expectedSignature !== razorpaySignature) {
          return new Response("Webhook signature mismatch", { status: 401 });
        }
      }

      let rzBody;
      try { rzBody = JSON.parse(rawBody); } catch(e) {
        return new Response("Bad JSON", { status: 400 });
      }

      const eventType = rzBody.event || "";

      // Only act on successful payment capture
      if (eventType === "payment.captured") {
        const payment    = rzBody.payload?.payment?.entity || {};
        const amount     = payment.amount ? (payment.amount / 100).toFixed(2) : "unknown"; // Razorpay uses paise
        const currency   = payment.currency || "INR";
        const paymentId  = payment.id || "N/A";
        const email      = payment.email || "Unknown";
        const contact    = payment.contact || "Not provided";
        const name       = payment.notes?.name || payment.description || "Customer";
        const orderId    = payment.order_id || "N/A";

        const amountNum  = parseFloat(amount);
        const planLabel  = amountNum <= 2500 ? "Single Session — $29" : "Monthly Mentorship — $99/month"; // INR equivalent

        // Notify Vishal
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Mentorship Payments", email: "contact@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            subject: `✅ Razorpay Payment Confirmed — ${escapeHtml(name)} · ${currency} ${amount}`,
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                <div style="background:#070A18;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center">
                  <h1 style="color:#E8BB6B;font-size:20px;margin:0;font-weight:400">✅ Razorpay Payment Confirmed</h1>
                  <p style="color:#7DE6FF;font-size:13px;margin:6px 0 0">Verified by Razorpay webhook — this is a real payment</p>
                </div>
                <div style="background:#f9f9f9;padding:24px 32px;border:1px solid #e0e0e0">
                  <p><strong>Customer Name:</strong> ${escapeHtml(name)}</p>
                  <p><strong>Customer Email:</strong> ${escapeHtml(email)}</p>
                  <p><strong>Contact:</strong> ${escapeHtml(contact)}</p>
                  <p><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}</p>
                  <p><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
                  <p><strong>Razorpay Payment ID:</strong> ${escapeHtml(paymentId)}</p>
                  <p><strong>Razorpay Order ID:</strong> ${escapeHtml(orderId)}</p>
                  <hr style="border:none;border-top:1px solid #e0e0e0;margin:18px 0">
                  <p style="font-size:12px;color:#888">This email was triggered by Razorpay's payment webhook — payment is captured and confirmed. Schedule the session within 2–3 business days.</p>
                </div>
              </div>
            `,
          }),
        }).catch(() => {});

        // Send confirmation to customer
        if (email && email !== "Unknown") {
          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
            body: JSON.stringify({
              sender: { name: "Vishal Hingol", email: "contact@vishalhingolauthor.com" },
              to: [{ email: email, name: name }],
              subject: "Your mentorship session is confirmed ✦",
              htmlContent: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                  <div style="background:#070A18;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center">
                    <h1 style="color:#E8BB6B;font-size:22px;margin:0;font-weight:400">Payment confirmed ✦</h1>
                    <p style="color:#9AA1C7;font-size:14px;margin:8px 0 0">Your ${escapeHtml(planLabel)} with Vishal Hingol is booked.</p>
                  </div>
                  <div style="background:#f9f9f9;padding:24px 32px;border:1px solid #e0e0e0">
                    <p>Hi ${escapeHtml(name)},</p>
                    <p>Your payment of <strong>${escapeHtml(currency)} ${escapeHtml(amount)}</strong> has been received and confirmed. Vishal will personally reach out within <strong>2–3 business days</strong> to schedule your session.</p>
                    <div style="background:#070A18;border-radius:10px;padding:16px 20px;margin:18px 0">
                      <p style="color:#9AA1C7;font-size:12px;margin:0 0 6px">Payment receipt</p>
                      <p style="color:#F4EEE2;margin:3px 0"><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
                      <p style="color:#F4EEE2;margin:3px 0"><strong>Amount:</strong> ${escapeHtml(currency)} ${escapeHtml(amount)}</p>
                      <p style="color:#F4EEE2;margin:3px 0"><strong>Reference:</strong> ${escapeHtml(paymentId)}</p>
                    </div>
                    <p>If you have questions before your session, reply to this email.</p>
                    <p>Vishal Hingol<br><a href="https://vishalhingolauthor.com" style="color:#E8BB6B">vishalhingolauthor.com</a></p>
                  </div>
                </div>
              `,
            }),
          }).catch(() => {});
        }
      }

      // Always return 200 to Razorpay
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    try {
      const body = await request.json();

      // ============================================================
      // PRODUCT ORDER — emails the order to Vishal via Brevo
      // + sends an order confirmation back to the customer
      // Completely separate from newsletter subscribe — does NOT
      // touch the Brevo contact list at all.
      // ============================================================
      if (body.type === "product_order") {
        const {
          productName, productPrice, productCategory, color, size,
          fullName, email, phone, country,
          addressLine1, addressLine2, city, state, postalCode,
          orderRef, paypalOrderId, paypalCaptureStatus,
        } = body;

        if (!productName || !fullName || !email || !addressLine1 || !city || !country || !color || !size) {
          return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 400, headers: cors });
        }

        // Find the logged-in account (checkout requires login, so this should
        // normally resolve — but we don't hard-fail the order if it doesn't,
        // since a successful payment should never be lost over a session quirk).
        let orderAccountId = null;
        if (env.ACCOUNTS_DB) {
          const cookieHeader = request.headers.get("Cookie") || "";
          const sessionMatch = cookieHeader.match(/session=([^;]+)/);
          if (sessionMatch) {
            const session = await env.ACCOUNTS_DB.prepare(
              "SELECT account_id, expires_at FROM sessions WHERE token = ?"
            ).bind(sessionMatch[1]).first();
            if (session && new Date(session.expires_at) >= new Date()) {
              orderAccountId = session.account_id;
            }
          }

          // Persist the order regardless of email outcome below
          await env.ACCOUNTS_DB.prepare(
            `INSERT INTO orders (id, account_id, order_ref, product_name, product_price, color, size,
              full_name, email, phone, address_line1, address_line2, city, state, postal_code, country,
              paypal_order_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            generateUUID(), orderAccountId, orderRef || null, productName, productPrice || null, color, size,
            fullName, email, phone || null, addressLine1, addressLine2 || null, city, state || null, postalCode || null, country,
            paypalOrderId || null, new Date().toISOString()
          ).run().catch(() => {}); // never block a confirmed payment's email on a DB hiccup
        }

        const addressBlock = [
          escapeHtml(addressLine1),
          addressLine2 ? escapeHtml(addressLine2) : null,
          `${escapeHtml(city)}${state ? ', ' + escapeHtml(state) : ''} ${postalCode ? escapeHtml(postalCode) : ''}`,
          escapeHtml(country),
        ].filter(Boolean).join("<br>");

        // Email 1: Notify Vishal — full order details
        const orderHtmlForVishal = `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#333;line-height:1.7">
            <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#E8BB6B;font-size:22px;margin:0;font-weight:400">New Order Received</h1>
              <p style="color:#9AA1C7;font-size:13px;margin:8px 0 0">${escapeHtml(orderRef || '')}</p>
            </div>
            <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
              <p style="background:#e8f7ec;border:1px solid #b8e6c4;border-radius:6px;padding:10px 14px;color:#1a6b3a"><strong>&#10003; Payment confirmed via PayPal</strong>${paypalOrderId ? ` &mdash; Order ID: ${escapeHtml(paypalOrderId)}` : ''}${paypalCaptureStatus ? ` (${escapeHtml(paypalCaptureStatus)})` : ''}</p>
              <p><strong>Product:</strong> ${escapeHtml(productName)}${productCategory ? ` <span style="color:#888">(${escapeHtml(productCategory)})</span>` : ''}</p>
              <p><strong>Price:</strong> ${escapeHtml(productPrice || '')}</p>
              <p><strong>Color:</strong> ${escapeHtml(color)}</p>
              <p><strong>Size:</strong> ${escapeHtml(size)}</p>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p><strong>Customer Name:</strong> ${escapeHtml(fullName)}</p>
              <p><strong>Email:</strong> ${escapeHtml(email)}</p>
              <p><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}</p>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p><strong>Shipping Address:</strong><br>${addressBlock}</p>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p style="font-size:13px;color:#888">Cross-check the PayPal Order ID above against your PayPal Business dashboard before printing/shipping. Sent from the shop order form on vishalhingolauthor.com</p>
            </div>
          </div>
        `;

        const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Signal Fashion Orders", email: "orders@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            replyTo: { email: email, name: fullName },
            subject: `New Order — ${String(productName).replace(/[\r\n]/g, ' ')} (${String(color).replace(/[\r\n]/g, ' ')}, ${String(size).replace(/[\r\n]/g, ' ')})`,
            htmlContent: orderHtmlForVishal,
          }),
        });

        if (brevoRes.ok) {
          // Email 2: Order confirmation back to the customer
          const orderHtmlForCustomer = `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
              <p>Hi ${escapeHtml(fullName)},</p>
              <p>We've received your order successfully — thank you! Your payment has been confirmed and we'll update you shortly as it moves through printing and shipping.</p>
              <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:20px 24px;margin:20px 0">
                <p style="margin:0 0 12px;font-family:monospace;font-size:13px;color:#888">Order Number: <strong style="color:#333">${escapeHtml(orderRef || 'N/A')}</strong></p>
                <p style="margin:0 0 8px"><strong>${escapeHtml(productName)}</strong></p>
                <p style="margin:0 0 4px;color:#555">Color: ${escapeHtml(color)}</p>
                <p style="margin:0 0 4px;color:#555">Size: ${escapeHtml(size)}</p>
                <p style="margin:0;color:#555">Price: ${escapeHtml(productPrice || '')}</p>
              </div>
              <p><strong>Shipping to:</strong><br>${addressBlock}</p>
              <p>Your item is printed on demand and typically ships within 5–7 business days. You'll receive tracking details once it's on its way.</p>
              <p>If anything above looks incorrect, just reply to this email and I'll fix it before printing begins. Please keep your order number handy if you need to contact us about this order.</p>
              <p>
                Vishal Hingol<br>
                <a href="https://vishalhingolauthor.com" style="color:#E8BB6B">vishalhingolauthor.com</a>
              </p>
            </div>
          `;

          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
            body: JSON.stringify({
              sender: { name: "Vishal Hingol", email: "orders@vishalhingolauthor.com" },
              to: [{ email: email, name: fullName }],
              subject: `Order Received — ${String(productName).replace(/[\r\n]/g, ' ')} (${String(orderRef || '').replace(/[\r\n]/g, ' ')})`,
              htmlContent: orderHtmlForCustomer,
            }),
          }).catch(() => {}); // Don't block if confirmation fails

          return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
        }

        const errBody = await brevoRes.text();
        return new Response(JSON.stringify({ success: false, error: "Could not send order. Please email contact@vishalhingolauthor.com directly.", debug: errBody }), { status: 500, headers: cors });
      }

      // ============================================================
      // PRODUCT ORDER ABANDONED — customer filled the form and
      // reached checkout, but payment failed or was cancelled.
      // Notifies Vishal ONLY (not the customer) so he can follow up
      // personally, e.g. with a discount offer. Does not touch the
      // newsletter list and is separate from the success-path email.
      // ============================================================
      if (body.type === "product_order_abandoned") {
        const {
          productName, productPrice, productCategory, color, size,
          fullName, email, phone, country,
          addressLine1, addressLine2, city, state, postalCode,
          orderRef, reason,
        } = body;

        if (!productName) {
          return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 400, headers: cors });
        }

        const addressBlock = [
          addressLine1 ? escapeHtml(addressLine1) : null,
          addressLine2 ? escapeHtml(addressLine2) : null,
          (city || state || postalCode) ? `${escapeHtml(city || '')}${state ? ', ' + escapeHtml(state) : ''} ${postalCode ? escapeHtml(postalCode) : ''}` : null,
          country ? escapeHtml(country) : null,
        ].filter(Boolean).join("<br>") || "Not provided";

        const abandonedHtml = `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#333;line-height:1.7">
            <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#FF9B9B;font-size:22px;margin:0;font-weight:400">Payment Not Completed</h1>
              <p style="color:#9AA1C7;font-size:13px;margin:8px 0 0">${escapeHtml(orderRef || '')}</p>
            </div>
            <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
              <p style="background:#fdecea;border:1px solid #f5c2bf;border-radius:6px;padding:10px 14px;color:#8a1f12"><strong>&#9888; ${escapeHtml(reason || 'Payment failed or was cancelled')}</strong> &mdash; no payment was captured.</p>
              <p><strong>Product:</strong> ${escapeHtml(productName)}${productCategory ? ` <span style="color:#888">(${escapeHtml(productCategory)})</span>` : ''}</p>
              <p><strong>Price:</strong> ${escapeHtml(productPrice || '')}</p>
              <p><strong>Color:</strong> ${escapeHtml(color || 'Not selected')}</p>
              <p><strong>Size:</strong> ${escapeHtml(size || 'Not selected')}</p>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p><strong>Customer Name:</strong> ${escapeHtml(fullName || 'Not provided')}</p>
              <p><strong>Email:</strong> ${escapeHtml(email || 'Not provided')}</p>
              <p><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}</p>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p><strong>Shipping Address (if provided):</strong><br>${addressBlock}</p>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p style="font-size:13px;color:#888">This customer reached checkout but did not complete payment. Consider following up directly — a personal email or a discount offer often recovers these. Sent from the shop order form on vishalhingolauthor.com</p>
            </div>
          </div>
        `;

        const abandonedEmailPayload = {
          sender: { name: "Signal Fashion Orders", email: "orders@vishalhingolauthor.com" },
          to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
          subject: `Payment Not Completed — ${String(productName).replace(/[\r\n]/g, ' ')} (${String(fullName || email || 'Unknown customer').replace(/[\r\n]/g, ' ')})`,
          htmlContent: abandonedHtml,
        };
        // Only set replyTo if we actually have a usable email — an empty replyTo can cause Brevo to reject the whole send
        if (email) {
          abandonedEmailPayload.replyTo = { email: email, name: fullName || "Customer" };
        }

        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify(abandonedEmailPayload),
        }).catch(() => {}); // Best-effort — never block the customer's UI on this

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
      }

      // ============================================================
      // CLIENT AGREEMENT — sends signed copy to both parties
      // ============================================================
      if (body.type === "client_agreement") {
        const { name, email, date, refId, agreements } = body;

        if (!name || !email || !agreements) {
          return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), { status: 400, headers: cors });
        }

        const agreementList = agreements.map((a, i) => `<li style="margin-bottom:8px;color:#333">${a}</li>`).join('');

        const agreementHtml = `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#333;line-height:1.7">
            <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#E8BB6B;font-size:22px;margin:0;font-weight:400">Client Agreement — Signed Copy</h1>
              <p style="color:#9AA1C7;font-size:13px;margin:8px 0 0">vishalhingolauthor.com</p>
            </div>
            <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
              <p><strong>Reference:</strong> ${refId}</p>
              <p><strong>Client Name:</strong> ${escapeHtml(name)}</p>
              <p><strong>Client Email:</strong> ${escapeHtml(email)}</p>
              <p><strong>Date Signed:</strong> ${escapeHtml(date)}</p>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p><strong>The client has confirmed agreement to the following terms:</strong></p>
              <ol style="padding-left:20px">${agreementList}</ol>
              <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
              <p style="font-size:13px;color:#888">This is an automated confirmation generated when the client accepted the mentorship agreement on vishalhingolauthor.com. Full terms available at <a href="https://vishalhingolauthor.com/policies.html">vishalhingolauthor.com/policies.html</a></p>
              <p style="font-size:13px;color:#888">Both the client and Vishal Hingol have received a copy of this agreement.</p>
            </div>
          </div>
        `;

        // Send to Vishal
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Client Agreement System", email: "contact@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            replyTo: { email: email, name: name },
            subject: `Client Agreement Signed — ${name} (${refId})`,
            htmlContent: agreementHtml,
          }),
        });

        // Send copy to client
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Vishal Hingol", email: "contact@vishalhingolauthor.com" },
            to: [{ email: email, name: name }],
            subject: `Your Mentorship Agreement — Signed Copy (${refId})`,
            htmlContent: agreementHtml,
          }),
        });

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
      }

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
      // MENTOR PAYMENT INTENT — fired BEFORE the customer clicks pay.
      // Captures their details, sends Vishal a "payment incoming" alert
      // with all their info, and returns an orderRef the client stores
      // to match against the payment confirmation that follows.
      // ============================================================
      if (body.type === "mentor_payment_intent") {
        const { name, email, phone, plan, timezone } = body;

        if (!name || !email || !plan) {
          return new Response(JSON.stringify({ success: false, error: "Name, email and plan are required." }), { status: 400, headers: cors });
        }

        const orderRef = "MP-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
        const planLabel = plan === "single" ? "Single Session — $29" : "Monthly Mentorship — $99/month";
        const now = new Date().toISOString();

        // Notify Vishal — payment is about to happen, here are the customer details
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Mentorship Payments", email: "contact@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            replyTo: { email: email, name: name },
            subject: `⚡ Mentorship Payment Incoming — ${escapeHtml(name)} · ${escapeHtml(planLabel)}`,
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
                  <h1 style="color:#E8BB6B;font-size:20px;margin:0;font-weight:400">⚡ Mentorship Payment Incoming</h1>
                  <p style="color:#9AA1C7;font-size:13px;margin:8px 0 0">Customer is about to pay — their details are below</p>
                </div>
                <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
                  <p><strong>Name:</strong> ${escapeHtml(name)}</p>
                  <p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
                  <p><strong>Phone/WhatsApp:</strong> ${escapeHtml(phone || "Not provided")}</p>
                  <p><strong>Timezone:</strong> ${escapeHtml(timezone || "Not provided")}</p>
                  <p><strong>Plan selected:</strong> ${escapeHtml(planLabel)}</p>
                  <p><strong>Order reference:</strong> ${escapeHtml(orderRef)}</p>
                  <p><strong>Timestamp:</strong> ${escapeHtml(now)}</p>
                  <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
                  <p style="font-size:12px;color:#888">This email fires when the customer submits their details and clicks to pay. A second confirmation will follow once payment is completed. If you don't receive a confirmation email within 30 minutes, the payment may not have gone through — reach out to ${escapeHtml(email)} to follow up.</p>
                </div>
              </div>
            `,
          }),
        }).catch(() => {});

        return new Response(JSON.stringify({ success: true, orderRef }), { status: 200, headers: cors });
      }

      // ============================================================
      // MENTOR PAYMENT CONFIRMED — fired AFTER payment succeeds
      // (from the PayPal onApprove / Razorpay success callback).
      // Sends Vishal a confirmed booking alert and sends the customer
      // a booking confirmation email with next steps.
      // ============================================================
      if (body.type === "mentor_payment_confirmed") {
        const { name, email, phone, plan, timezone, orderRef, paymentId } = body;

        if (!name || !email || !plan) {
          return new Response(JSON.stringify({ success: false, error: "Missing required fields." }), { status: 400, headers: cors });
        }

        const planLabel = plan === "single" ? "Single Session — $29" : "Monthly Mentorship — $99/month";
        const planAmount = plan === "single" ? "$29 USD" : "$99 USD/month";

        // Email 1: Notify Vishal — confirmed booking
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Mentorship Payments", email: "contact@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            replyTo: { email: email, name: name },
            subject: `✅ Confirmed — ${escapeHtml(name)} booked ${escapeHtml(planLabel)}`,
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
                  <h1 style="color:#E8BB6B;font-size:20px;margin:0;font-weight:400">✅ New Mentorship Session Booked</h1>
                </div>
                <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
                  <p><strong>Name:</strong> ${escapeHtml(name)}</p>
                  <p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
                  <p><strong>Phone/WhatsApp:</strong> ${escapeHtml(phone || "Not provided")}</p>
                  <p><strong>Timezone:</strong> ${escapeHtml(timezone || "Not provided")}</p>
                  <p><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
                  <p><strong>Amount:</strong> ${escapeHtml(planAmount)}</p>
                  <p><strong>Order reference:</strong> ${escapeHtml(orderRef || "N/A")}</p>
                  <p><strong>Payment ID:</strong> ${escapeHtml(paymentId || "N/A")}</p>
                  <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
                  <p style="font-size:13px;color:#555">Reply to this email to contact the customer directly, or email them at <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>. Reply within 2–3 days to schedule the session.</p>
                </div>
              </div>
            `,
          }),
        }).catch(() => {});

        // Email 2: Confirmation to customer
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Vishal Hingol", email: "contact@vishalhingolauthor.com" },
            to: [{ email: email, name: name || "Reader" }],
            subject: "Your mentorship session is confirmed ✦",
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
                  <h1 style="color:#E8BB6B;font-size:22px;margin:0;font-weight:400">You're booked ✦</h1>
                  <p style="color:#9AA1C7;font-size:14px;margin:10px 0 0">Your ${escapeHtml(planLabel)} with Vishal Hingol is confirmed.</p>
                </div>
                <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
                  <p>Hi ${escapeHtml(name)},</p>
                  <p>Your payment has been received and your session is confirmed. Here is what happens next:</p>
                  <ul>
                    <li>I will personally reach out within <strong>2–3 business days</strong> to schedule your session at a time that works for both of us</li>
                    <li>Sessions are conducted via <strong>video call</strong> (Zoom, Google Meet, or WhatsApp Video — your preference)</li>
                    <li>Before your first session, please <a href="https://vishalhingolauthor.com/agreement.html" style="color:#E8BB6B">sign the Client Agreement</a> if you haven't already</li>
                  </ul>
                  <div style="background:#070A18;border-radius:10px;padding:18px 22px;margin:20px 0">
                    <p style="color:#9AA1C7;font-size:13px;margin:0 0 8px">Your booking details</p>
                    <p style="color:#F4EEE2;margin:4px 0"><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
                    <p style="color:#F4EEE2;margin:4px 0"><strong>Amount paid:</strong> ${escapeHtml(planAmount)}</p>
                    <p style="color:#F4EEE2;margin:4px 0"><strong>Reference:</strong> ${escapeHtml(orderRef || "N/A")}</p>
                  </div>
                  <p>If you have any questions before your session, reply to this email directly.</p>
                  <p>Looking forward to our conversation.</p>
                  <p>Vishal Hingol<br>
                  <a href="https://vishalhingolauthor.com" style="color:#E8BB6B">vishalhingolauthor.com</a></p>
                  <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
                  <p style="font-size:11px;color:#aaa">Refund & cancellation terms: <a href="https://vishalhingolauthor.com/policies.html" style="color:#E8BB6B">vishalhingolauthor.com/policies.html</a></p>
                </div>
              </div>
            `,
          }),
        }).catch(() => {});

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
      }

      // ============================================================
      // ACCOUNT SIGNUP — creates a new customer account (email/password)
      // Stores in D1 (ACCOUNTS_DB binding), sends you a notification
      // email, and returns a session token as a cookie.
      // ============================================================
      if (body.type === "account_signup") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: false, error: "Accounts database is not configured yet." }), { status: 500, headers: cors });
        }

        const { email, password, fullName, phone, topics, otherNotes } = body;

        if (!email || !email.includes("@") || !password || password.length < 8) {
          return new Response(JSON.stringify({ success: false, error: "Please provide a valid email and a password of at least 8 characters." }), { status: 400, headers: cors });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        // Check for existing account
        const existing = await env.ACCOUNTS_DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(normalizedEmail).first();
        if (existing) {
          return new Response(JSON.stringify({ success: false, error: "An account with this email already exists. Try logging in instead." }), { status: 409, headers: cors });
        }

        const accountId = generateUUID();
        const salt = generateSalt();
        const passwordHash = await hashPassword(password, salt);
        const now = new Date().toISOString();

        await env.ACCOUNTS_DB.prepare(
          "INSERT INTO accounts (id, email, password_hash, password_salt, full_name, phone, created_at, auth_provider) VALUES (?, ?, ?, ?, ?, ?, ?, 'password')"
        ).bind(accountId, normalizedEmail, passwordHash, salt, fullName || null, phone || null, now).run();

        // Store preferences (topics as comma-separated keys, plus free-text notes)
        const topicsStr = Array.isArray(topics) ? topics.join(',') : (topics || '');
        if (topicsStr || otherNotes) {
          await env.ACCOUNTS_DB.prepare(
            "INSERT INTO account_preferences (account_id, topics, other_notes, updated_at) VALUES (?, ?, ?, ?)"
          ).bind(accountId, topicsStr, otherNotes || null, now).run();
        }

        const sessionToken = await createSession(env.ACCOUNTS_DB, accountId);

        // Notify Vishal of new account creation — separate from order/newsletter emails
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Signal Fashion Accounts", email: "orders@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            subject: `New Account Created — ${escapeHtml(fullName || normalizedEmail)}`,
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
                  <h1 style="color:#7DE6FF;font-size:22px;margin:0;font-weight:400">New Account Created</h1>
                </div>
                <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
                  <p><strong>Name:</strong> ${escapeHtml(fullName || "Not provided")}</p>
                  <p><strong>Email:</strong> ${escapeHtml(normalizedEmail)}</p>
                  <p><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}</p>
                  <p><strong>Interests:</strong> ${escapeHtml(topicsStr || "Not specified")}</p>
                  <p><strong>Other notes:</strong> ${escapeHtml(otherNotes || "None")}</p>
                  <p><strong>Created:</strong> ${escapeHtml(now)}</p>
                  <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
                  <p style="font-size:13px;color:#888">Sent from the Signal Fashion account system on vishalhingolauthor.com</p>
                </div>
              </div>
            `,
          }),
        }).catch(() => {}); // best-effort, never block signup on email failure

        return new Response(JSON.stringify({ success: true, accountId }), {
          status: 200,
          headers: { ...cors, "Set-Cookie": `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000` },
        });
      }

      // ============================================================
      // ACCOUNT LOGIN — verifies email/password, issues a session
      // ============================================================
      if (body.type === "account_login") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: false, error: "Accounts database is not configured yet." }), { status: 500, headers: cors });
        }

        const { email, password, rememberMe } = body;
        if (!email || !password) {
          return new Response(JSON.stringify({ success: false, error: "Please provide both email and password." }), { status: 400, headers: cors });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const account = await env.ACCOUNTS_DB.prepare(
          "SELECT id, password_hash, password_salt FROM accounts WHERE email = ?"
        ).bind(normalizedEmail).first();

        if (!account) {
          return new Response(JSON.stringify({ success: false, error: "Incorrect email or password." }), { status: 401, headers: cors });
        }

        const computedHash = await hashPassword(password, account.password_salt);
        if (computedHash !== account.password_hash) {
          return new Response(JSON.stringify({ success: false, error: "Incorrect email or password." }), { status: 401, headers: cors });
        }

        await env.ACCOUNTS_DB.prepare("UPDATE accounts SET last_login_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), account.id).run();

        // "Remember Me" controls both the server-side session lifetime (D1
        // expires_at) and whether the browser keeps the cookie after closing.
        // Persistent: 30 days, with Max-Age so the browser retains it.
        // Not remembered: 1 day server-side as a backstop, but the cookie
        // itself omits Max-Age entirely, making it a true session cookie
        // the browser discards when closed — that's what actually enforces
        // "log in again after closing the site", not the D1 expiry value.
        const persistent = !!rememberMe;
        const sessionToken = await createSession(env.ACCOUNTS_DB, account.id, persistent ? 30 : 1);
        const cookieAttrs = `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=None` + (persistent ? `; Max-Age=2592000` : ``);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...cors, "Set-Cookie": cookieAttrs },
        });
      }

      // ============================================================
      // ADMIN ACCESS — secret key login for site owner
      // POST { type: "admin_access", key: "SECRET" }
      // Creates a full session for chudasama493@gmail.com
      // if the key matches ADMIN_SECRET env variable.
      // ============================================================
      if (body.type === "admin_access") {
        const providedKey = (body.key || "").trim();
        const adminSecret = env.ADMIN_SECRET || "";

        if (!providedKey || providedKey !== adminSecret) {
          return new Response(JSON.stringify({ success: false, error: "Invalid key" }), { status: 401, headers: cors });
        }

        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: false, error: "DB not available" }), { status: 500, headers: cors });
        }

        const ADMIN_EMAIL = "chudasama493@gmail.com";

        // Get or create the admin account
        let account = await env.ACCOUNTS_DB.prepare(
          "SELECT id FROM accounts WHERE email = ?"
        ).bind(ADMIN_EMAIL).first();

        if (!account) {
          await env.ACCOUNTS_DB.prepare(
            "INSERT INTO accounts (email, full_name, is_premium) VALUES (?, ?, 1)"
          ).bind(ADMIN_EMAIL, "Vishal Hingol").run();
          account = await env.ACCOUNTS_DB.prepare(
            "SELECT id FROM accounts WHERE email = ?"
          ).bind(ADMIN_EMAIL).first();
        } else {
          // Always ensure admin is premium
          await env.ACCOUNTS_DB.prepare(
            "UPDATE accounts SET is_premium = 1 WHERE email = ?"
          ).bind(ADMIN_EMAIL).run();
        }

        // Create session token — expires in 30 days
        const token = crypto.randomUUID();
        const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await env.ACCOUNTS_DB.prepare(
          "INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)"
        ).bind(token, account.id, expires).run();

        return new Response(JSON.stringify({ success: true, message: "Admin access granted" }), {
          status: 200,
          headers: {
            ...cors,
            "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${30 * 24 * 60 * 60}`,
          },
        });
      }

      // ============================================================
      // ACCOUNT LOGOUT — invalidates the session
      // ============================================================
      if (body.type === "account_logout") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
        }
        const cookieHeader = request.headers.get("Cookie") || "";
        const match = cookieHeader.match(/session=([^;]+)/);
        if (match) {
          await env.ACCOUNTS_DB.prepare("DELETE FROM sessions WHERE token = ?").bind(match[1]).run();
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...cors, "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0" },
        });
      }

      // ============================================================
      // CHECK SESSION — lets a page ask "is this visitor logged in?"
      // Reads the session cookie (sent automatically by the browser
      // when credentials:'include' is used), validates it against
      // D1, and returns basic account info if valid. Used by the
      // order pages to gate checkout behind login.
      // ============================================================
      if (body.type === "check_session") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: true, loggedIn: false }), { status: 200, headers: cors });
        }

        const cookieHeader = request.headers.get("Cookie") || "";
        const match = cookieHeader.match(/session=([^;]+)/);
        if (!match) {
          return new Response(JSON.stringify({ success: true, loggedIn: false }), { status: 200, headers: cors });
        }

        const session = await env.ACCOUNTS_DB.prepare(
          "SELECT account_id, expires_at FROM sessions WHERE token = ?"
        ).bind(match[1]).first();

        if (!session || new Date(session.expires_at) < new Date()) {
          return new Response(JSON.stringify({ success: true, loggedIn: false }), { status: 200, headers: cors });
        }

        const account = await env.ACCOUNTS_DB.prepare(
          "SELECT email, full_name, phone, is_premium FROM accounts WHERE id = ?"
        ).bind(session.account_id).first();

        if (!account) {
          return new Response(JSON.stringify({ success: true, loggedIn: false }), { status: 200, headers: cors });
        }

        return new Response(JSON.stringify({
          success: true,
          loggedIn: true,
          email: account.email,
          fullName: account.full_name,
          phone: account.phone,
          isPremium: !!account.is_premium || account.email === 'chudasama493@gmail.com',
          isAdmin: account.email === 'chudasama493@gmail.com',
        }), { status: 200, headers: cors });
      }

      // ============================================================
      // CONFIRM PREMIUM SUBSCRIPTION — called after PayPal's own
      // onApprove callback confirms a Deep Signal subscription
      // succeeded. Requires the customer to be logged in (an account
      // is required to subscribe to Deep Signal). Marks the account
      // premium and sends you a notification so you can cross-check
      // against your PayPal Business dashboard.
      // ============================================================
      if (body.type === "confirm_premium_subscription") {
        const auth = await resolveSession(env, request);
        if (!auth) {
          return new Response(JSON.stringify({ success: false, error: "Please sign in before subscribing to Deep Signal." }), { status: 401, headers: cors });
        }

        const { paypalSubscriptionId } = body;
        if (!paypalSubscriptionId) {
          return new Response(JSON.stringify({ success: false, error: "Missing subscription ID." }), { status: 400, headers: cors });
        }

        const now = new Date().toISOString();
        await env.ACCOUNTS_DB.prepare(
          "UPDATE accounts SET is_premium = 1, premium_paypal_subscription_id = ?, premium_started_at = ?, premium_cancelled_at = NULL WHERE id = ?"
        ).bind(paypalSubscriptionId, now, auth.accountId).run();

        const account = await env.ACCOUNTS_DB.prepare(
          "SELECT email, full_name FROM accounts WHERE id = ?"
        ).bind(auth.accountId).first();

        // Notify Vishal — cross-check this PayPal Subscription ID against your PayPal Business dashboard
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
          body: JSON.stringify({
            sender: { name: "Signal Newsletter", email: "orders@vishalhingolauthor.com" },
            to: [{ email: YOUR_INBOX_EMAIL, name: YOUR_NAME }],
            subject: `New Deep Signal Subscriber — ${escapeHtml((account && account.full_name) || (account && account.email) || "Unknown")}`,
            htmlContent: `
              <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;line-height:1.7">
                <div style="background:#070A18;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
                  <h1 style="color:#E8BB6B;font-size:22px;margin:0;font-weight:400">✦ New Deep Signal Subscriber</h1>
                </div>
                <div style="background:#f9f9f9;padding:28px 32px;border:1px solid #e0e0e0">
                  <p><strong>Name:</strong> ${escapeHtml((account && account.full_name) || "Not provided")}</p>
                  <p><strong>Email:</strong> ${escapeHtml((account && account.email) || "Unknown")}</p>
                  <p><strong>PayPal Subscription ID:</strong> ${escapeHtml(paypalSubscriptionId)}</p>
                  <p><strong>Started:</strong> ${escapeHtml(now)}</p>
                  <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
                  <p style="font-size:13px;color:#888">Cross-reference this Subscription ID in your PayPal Business dashboard to confirm billing is active. Sent from the Deep Signal subscription flow on vishalhingolauthor.com</p>
                </div>
              </div>
            `,
          }),
        }).catch(() => {});

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
      }

      // ============================================================
      // ACCOUNT DASHBOARD — returns profile + preferences + order
      // history in one call, for the customer's account page.
      // ============================================================
      if (body.type === "get_account_dashboard") {
        const auth = await resolveSession(env, request);
        if (!auth) {
          return new Response(JSON.stringify({ success: false, error: "Not logged in." }), { status: 401, headers: cors });
        }

        const account = await env.ACCOUNTS_DB.prepare(
          "SELECT email, full_name, phone, created_at FROM accounts WHERE id = ?"
        ).bind(auth.accountId).first();

        const prefs = await env.ACCOUNTS_DB.prepare(
          "SELECT topics, other_notes FROM account_preferences WHERE account_id = ?"
        ).bind(auth.accountId).first();

        const ordersResult = await env.ACCOUNTS_DB.prepare(
          "SELECT order_ref, product_name, product_price, color, size, created_at FROM orders WHERE account_id = ? ORDER BY created_at DESC"
        ).bind(auth.accountId).all();

        return new Response(JSON.stringify({
          success: true,
          account: account || {},
          preferences: prefs || { topics: '', other_notes: '' },
          orders: (ordersResult && ordersResult.results) || [],
        }), { status: 200, headers: cors });
      }

      // ============================================================
      // ACCOUNT UPDATE — edit name/phone/preferences. Email and
      // password changes are intentionally not supported here yet
      // to avoid the extra verification flow that should accompany
      // them (e.g. re-auth, email confirmation) — keep this simple
      // for now and revisit if needed.
      // ============================================================
      if (body.type === "account_update") {
        const auth = await resolveSession(env, request);
        if (!auth) {
          return new Response(JSON.stringify({ success: false, error: "Not logged in." }), { status: 401, headers: cors });
        }

        const { fullName, phone, topics, otherNotes } = body;
        const now = new Date().toISOString();

        await env.ACCOUNTS_DB.prepare(
          "UPDATE accounts SET full_name = ?, phone = ? WHERE id = ?"
        ).bind(fullName || null, phone || null, auth.accountId).run();

        const topicsStr = Array.isArray(topics) ? topics.join(',') : (topics || '');
        const existingPrefs = await env.ACCOUNTS_DB.prepare(
          "SELECT account_id FROM account_preferences WHERE account_id = ?"
        ).bind(auth.accountId).first();

        if (existingPrefs) {
          await env.ACCOUNTS_DB.prepare(
            "UPDATE account_preferences SET topics = ?, other_notes = ?, updated_at = ? WHERE account_id = ?"
          ).bind(topicsStr, otherNotes || null, now, auth.accountId).run();
        } else {
          await env.ACCOUNTS_DB.prepare(
            "INSERT INTO account_preferences (account_id, topics, other_notes, updated_at) VALUES (?, ?, ?, ?)"
          ).bind(auth.accountId, topicsStr, otherNotes || null, now).run();
        }

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
      }

      // ============================================================
      // ACCOUNT DELETE — permanently removes the account and its
      // sessions/preferences. Orders and comments are KEPT (with
      // account_id left dangling is avoided by nulling it) so your
      // own order records and public comments aren't silently
      // destroyed by a customer deleting their account.
      // ============================================================
      if (body.type === "account_delete") {
        const auth = await resolveSession(env, request);
        if (!auth) {
          return new Response(JSON.stringify({ success: false, error: "Not logged in." }), { status: 401, headers: cors });
        }

        await env.ACCOUNTS_DB.prepare("UPDATE orders SET account_id = NULL WHERE account_id = ?").bind(auth.accountId).run().catch(() => {});
        await env.ACCOUNTS_DB.prepare("DELETE FROM account_preferences WHERE account_id = ?").bind(auth.accountId).run().catch(() => {});
        await env.ACCOUNTS_DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(auth.accountId).run().catch(() => {});
        await env.ACCOUNTS_DB.prepare("DELETE FROM accounts WHERE id = ?").bind(auth.accountId).run();

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...cors, "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0" },
        });
      }

      // ============================================================
      // SUBMIT COMMENT — shows immediately (moderate-after model).
      // ============================================================
      if (body.type === "submit_comment") {
        const auth = await resolveSession(env, request);
        if (!auth) {
          return new Response(JSON.stringify({ success: false, error: "Please sign in to comment." }), { status: 401, headers: cors });
        }

        const { articleSlug, commentBody } = body;
        if (!articleSlug || !commentBody || !commentBody.trim()) {
          return new Response(JSON.stringify({ success: false, error: "Comment cannot be empty." }), { status: 400, headers: cors });
        }
        if (commentBody.length > 2000) {
          return new Response(JSON.stringify({ success: false, error: "Comment is too long (2000 character max)." }), { status: 400, headers: cors });
        }

        const commentId = generateUUID();
        const now = new Date().toISOString();
        await env.ACCOUNTS_DB.prepare(
          "INSERT INTO comments (id, article_slug, account_id, body, created_at, is_hidden) VALUES (?, ?, ?, ?, ?, 0)"
        ).bind(commentId, articleSlug, auth.accountId, commentBody.trim(), now).run();

        return new Response(JSON.stringify({ success: true, commentId, createdAt: now }), { status: 200, headers: cors });
      }

      // ============================================================
      // GET COMMENTS — public read, no login required to VIEW.
      // ============================================================
      if (body.type === "get_comments") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: true, comments: [] }), { status: 200, headers: cors });
        }
        const { articleSlug } = body;
        if (!articleSlug) {
          return new Response(JSON.stringify({ success: false, error: "Missing articleSlug." }), { status: 400, headers: cors });
        }

        const result = await env.ACCOUNTS_DB.prepare(
          `SELECT comments.id, comments.body, comments.created_at, accounts.full_name
           FROM comments JOIN accounts ON comments.account_id = accounts.id
           WHERE comments.article_slug = ? AND comments.is_hidden = 0
           ORDER BY comments.created_at DESC`
        ).bind(articleSlug).all();

        return new Response(JSON.stringify({ success: true, comments: (result && result.results) || [] }), { status: 200, headers: cors });
      }

      // ============================================================
      // SUBMIT RATING — one rating per account per article; submitting
      // again updates the existing rating rather than duplicating.
      // ============================================================
      if (body.type === "submit_rating") {
        const auth = await resolveSession(env, request);
        if (!auth) {
          return new Response(JSON.stringify({ success: false, error: "Please sign in to rate this article." }), { status: 401, headers: cors });
        }

        const { articleSlug, stars } = body;
        const starsNum = parseInt(stars, 10);
        if (!articleSlug || !starsNum || starsNum < 1 || starsNum > 5) {
          return new Response(JSON.stringify({ success: false, error: "Please provide a rating between 1 and 5 stars." }), { status: 400, headers: cors });
        }

        await env.ACCOUNTS_DB.prepare(
          "INSERT INTO ratings (article_slug, account_id, stars, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(article_slug, account_id) DO UPDATE SET stars = excluded.stars, created_at = excluded.created_at"
        ).bind(articleSlug, auth.accountId, starsNum, new Date().toISOString()).run();

        return new Response(JSON.stringify({ success: true }), { status: 200, headers: cors });
      }

      // ============================================================
      // GET RATINGS — public read; returns average + count + (if
      // logged in) the current visitor's own rating.
      // ============================================================
      if (body.type === "get_ratings") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: true, average: 0, count: 0, yourRating: null }), { status: 200, headers: cors });
        }
        const { articleSlug } = body;
        if (!articleSlug) {
          return new Response(JSON.stringify({ success: false, error: "Missing articleSlug." }), { status: 400, headers: cors });
        }

        const agg = await env.ACCOUNTS_DB.prepare(
          "SELECT AVG(stars) as average, COUNT(*) as count FROM ratings WHERE article_slug = ?"
        ).bind(articleSlug).first();

        let yourRating = null;
        const auth = await resolveSession(env, request);
        if (auth) {
          const mine = await env.ACCOUNTS_DB.prepare(
            "SELECT stars FROM ratings WHERE article_slug = ? AND account_id = ?"
          ).bind(articleSlug, auth.accountId).first();
          if (mine) yourRating = mine.stars;
        }

        return new Response(JSON.stringify({
          success: true,
          average: (agg && agg.average) || 0,
          count: (agg && agg.count) || 0,
          yourRating,
        }), { status: 200, headers: cors });
      }

      // ============================================================
      // NEWSLETTER SUBSCRIBE — existing behaviour, unchanged
      // Completely separate from product orders above. Subscribing
      // never sends an order email, and ordering never touches
      // this contact list.
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

// ============================================================
// Account system crypto helpers (Stage 1)
// Uses the Web Crypto API native to Cloudflare Workers — no
// external dependencies. PBKDF2 with 100,000 iterations and
// SHA-256, which is a widely accepted secure default.
// ============================================================

function generateUUID() {
  return crypto.randomUUID();
}

function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();
  const saltBytes = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  const hashBytes = new Uint8Array(derivedBits);
  return Array.from(hashBytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function createSession(db, accountId, expiryDays) {
  const token = generateUUID() + generateUUID(); // extra-long random token
  const now = new Date();
  const days = expiryDays || 30; // default to 30 days when not specified (e.g. right after signup)
  const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  await db.prepare(
    "INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, accountId, now.toISOString(), expires.toISOString()).run();
  return token;
}

// Reads the session cookie from a request and validates it against D1.
// Returns { accountId } if valid, or null if not logged in / expired /
// database not configured. Shared by every branch that needs to know
// "who is making this request", so the same validation logic and
// expiry check lives in exactly one place.
async function resolveSession(env, request) {
  if (!env.ACCOUNTS_DB) return null;
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/session=([^;]+)/);
  if (!match) return null;

  const session = await env.ACCOUNTS_DB.prepare(
    "SELECT account_id, expires_at FROM sessions WHERE token = ?"
  ).bind(match[1]).first();

  if (!session || new Date(session.expires_at) < new Date()) return null;
  return { accountId: session.account_id };
}
