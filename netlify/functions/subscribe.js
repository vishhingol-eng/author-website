// netlify/functions/subscribe.js
// Receives an email from the website signup form and adds it to Brevo list #3 (Website Subscribers)
// The API key stays here, server-side, and is never exposed to the visitor's browser.

exports.handler = async function (event) {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // CORS headers so your site (any domain) can call this function
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  try {
    const { email } = JSON.parse(event.body || "{}");

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Please enter a valid email address." }),
      };
    }

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Server configuration error." }),
      };
    }

    // Call Brevo's API to add the contact to list #3
    const response = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        email: email,
        listIds: [3],
        updateEnabled: true, // if they already exist, just update rather than error
      }),
    });

    // Brevo returns 201 for new contact, 204 for updated existing contact
    if (response.status === 201 || response.status === 204) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: "You're subscribed!" }),
      };
    }

    // Handle Brevo errors (e.g. duplicate contact edge cases)
    const errorData = await response.json().catch(() => ({}));

    // "Contact already exist" is not really an error from the user's perspective
    if (errorData.code === "duplicate_parameter") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: "You're already subscribed!" }),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: errorData.message || "Something went wrong. Please try again.",
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server error. Please try again later." }),
    };
  }
};
