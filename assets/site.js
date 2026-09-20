const MILEO_API_URL =
  "https://script.google.com/macros/s/AKfycbymeTm42qP3ko1iZl1tNE_e607mSiLDGpqwMdUHE_tMFo2ggnyHXkL8rMzgN6HaxyDo/exec";

const form = document.getElementById("enquiryForm");
const status = document.getElementById("formStatus");

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = form.querySelector(".submit");
    const formData = new FormData(form);

    const data = {
      name: formData.get("name") || "",
      email: formData.get("email") || "",
      phone: formData.get("phone") || "",
      course: formData.get("course") || "",
      notes: formData.get("notes") || "",
      trialRequested: formData.get("trialRequested") || "No",
      source: "Website"
    };

    button.disabled = true;
    button.textContent = "Sending…";
    status.textContent = "";

    try {
      await fetch(MILEO_API_URL, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        }
      });

      status.textContent = "✓ Thanks — your enquiry has been received.";
      form.reset();

    } catch (error) {
      console.error(error);
      status.textContent =
        "We couldn't send your enquiry. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Send my enquiry →";
    }
  });
}
