const API_BASE = import.meta.env.VITE_API_URL ||  "http://localhost:8000";

export async function uploadPDF(file) {
  const formData = new FormData();
  formData.append("pdf", file);

  const response = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "PDF upload failed");
  }
  return data;
}

export async function getJobStatus(jobId) {
  const response = await fetch(`${API_BASE}/api/job-status/${jobId}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || "Failed to fetch job status");
  }

  return data;
}

export async function getUploadedPDFs() {
  const res = await fetch(`${API_BASE}/api/pdfs`);
  const data = await res.json();

  if (!res.ok) throw new Error(data?.error || "Failed to load PDFs");
  return data;
}

export async function deletePDFByName(pdfName) {
  const res = await fetch(`${API_BASE}/api/pdfs/${encodeURIComponent(pdfName)}`, {
    method: "DELETE",
  });
  const data = await res.json();

  if (!res.ok) throw new Error(data?.error || "Failed to delete PDF");
  return data;
}

export async function chatWithPDF(message, pdfName = null) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, pdfName }),
  });
  const data = await res.json();

  if (!res.ok) throw new Error(data?.error || "Chat failed");
  return data;
}