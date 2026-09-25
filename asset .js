const MILEO_API_URL =
  "https://script.google.com/macros/s/AKfycbymeTm42qP3ko1iZl1tNE_e607mSiLDGpqwMdUHE_tMFo2ggnyHXkL8rMzgN6HaxyDo/exec";

const form = document.getElementById("enquiryForm");
const status = document.getElementById("formStatus");

function showStatus(text, type) {
  status.textContent = text;
  status.className = type || "";
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = form.querySelector(".submit");
    const formData = new FormData(form);

    const data = {
      name: (formData.get("name") || "").trim(),
      email: (formData.get("email") || "").trim(),
      phone: (formData.get("phone") || "").trim(),
      course: formData.get("course") || "",
      notes: (formData.get("notes") || "").trim(),
      trialRequested: formData.get("trialRequested") || "No",
      source: "Website"
    };

    button.disabled = true;
    button.textContent = "Sending…";
    showStatus("");

    try {
      const response = await fetch(MILEO_API_URL, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        }
      });

      let result = null;

      try {
        result = await response.json();
      } catch (parseError) {
        result = null;
      }

      if (!response.ok || !result || result.success !== true) {
        throw new Error(
          (result && result.message) ||
          "We couldn't send your enquiry. Please try again."
        );
      }

      showStatus("✓ Thanks — your enquiry has been received.", "ok");
      form.reset();

    } catch (error) {
      console.error(error);
      showStatus(
        error.message || "We couldn't send your enquiry. Please try again.",
        "bad"
      );
    } finally {
      button.disabled = false;
      button.textContent = "Send my enquiry →";
    }
  });
}
