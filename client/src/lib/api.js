const API_BASE = "http://localhost:8000/api";

export async function uploadPDF(file) {
  const formData = new FormData();
  formData.append("pdf", file);

  const response = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "PDF upload failed");
  }
  return data;
}

export async function chatWithPDF(message) {
  const response = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Chat request failed");
  }
  return data;
}

export async function getJobStatus(jobId) {
  const response = await fetch(`${API_BASE}/job-status/${jobId}`);

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "Failed to fetch job status");
  }

  return data;
}