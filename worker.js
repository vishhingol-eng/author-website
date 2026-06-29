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
              <p>Thanks for your order — your payment has been confirmed. Here's a summary of what you ordered:</p>
              <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:20px 24px;margin:20px 0">
                <p style="margin:0 0 8px"><strong>${escapeHtml(productName)}</strong></p>
                <p style="margin:0 0 4px;color:#555">Color: ${escapeHtml(color)}</p>
                <p style="margin:0 0 4px;color:#555">Size: ${escapeHtml(size)}</p>
                <p style="margin:0;color:#555">Price: ${escapeHtml(productPrice || '')}</p>
              </div>
              <p><strong>Shipping to:</strong><br>${addressBlock}</p>
              <p>Your item is printed on demand and typically ships within 5–7 business days. You'll receive tracking details once it's on its way.</p>
              <p>If anything above looks incorrect, just reply to this email and I'll fix it before printing begins.</p>
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
              subject: `Order Confirmed — ${String(productName).replace(/[\r\n]/g, ' ')}`,
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
      // ACCOUNT SIGNUP — creates a new customer account (email/password)
      // Stores in D1 (ACCOUNTS_DB binding), sends you a notification
      // email, and returns a session token as a cookie.
      // ============================================================
      if (body.type === "account_signup") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: false, error: "Accounts database is not configured yet." }), { status: 500, headers: cors });
        }

        const { email, password, fullName, phone } = body;

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
          headers: { ...cors, "Set-Cookie": `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` },
        });
      }

      // ============================================================
      // ACCOUNT LOGIN — verifies email/password, issues a session
      // ============================================================
      if (body.type === "account_login") {
        if (!env.ACCOUNTS_DB) {
          return new Response(JSON.stringify({ success: false, error: "Accounts database is not configured yet." }), { status: 500, headers: cors });
        }

        const { email, password } = body;
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

        const sessionToken = await createSession(env.ACCOUNTS_DB, account.id);

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...cors, "Set-Cookie": `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` },
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
          headers: { ...cors, "Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" },
        });
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

async function createSession(db, accountId) {
  const token = generateUUID() + generateUUID(); // extra-long random token
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await db.prepare(
    "INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, accountId, now.toISOString(), expires.toISOString()).run();
  return token;
}
