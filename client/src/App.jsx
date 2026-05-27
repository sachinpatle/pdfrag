import { useEffect, useRef, useState } from "react";
import {
  uploadPDF,
  chatWithPDF,
  getJobStatus,
  getUploadedPDFs,
  deletePDFByName,
} from "./lib/api";
import VectorSpace from "./VectorSpace"; // 📍 Yeh line add karein

const getInitialTheme = () => {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

export default function App() {
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const pollingIntervalRef = useRef(null);

  const [isDark, setIsDark] = useState(getInitialTheme);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  const [jobId, setJobId] = useState("");
  const [jobStatus, setJobStatus] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lastUploadedPdfName, setLastUploadedPdfName] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Upload a PDF and ask anything from it.",
      sources: [],
    },
  ]);

  const [pdfList, setPdfList] = useState([]);
  const [selectedPdfName, setSelectedPdfName] = useState("");
  const [deletingPdf, setDeletingPdf] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    loadPDFs();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const loadPDFs = async (preferredPdfName = "") => {
    try {
      const data = await getUploadedPDFs();
      const pdfs = Array.isArray(data?.pdfs) ? data.pdfs : [];
      setPdfList(pdfs);

      if (pdfs.length === 0) {
        setSelectedPdfName("");
        return;
      }

      if (preferredPdfName && pdfs.includes(preferredPdfName)) {
        setSelectedPdfName(preferredPdfName);
        return;
      }

      if (selectedPdfName && pdfs.includes(selectedPdfName)) {
        return;
      }

      setSelectedPdfName(pdfs[0]);
    } catch (error) {
      console.error(error);
    }
  };

  const handleDeletePdf = async (pdfName) => {
    try {
      setDeletingPdf(pdfName);
      setErrorMessage("");
      setUploadMessage("");

      await deletePDFByName(pdfName);

      const remainingPdfs = pdfList.filter((item) => item !== pdfName);
      setPdfList(remainingPdfs);

      if (remainingPdfs.length === 0) {
        setSelectedPdfName("");
      } else if (selectedPdfName === pdfName) {
        setSelectedPdfName(remainingPdfs[0]);
      }

      setUploadMessage(`✅ ${pdfName} deleted successfully.`);
    } catch (error) {
      setErrorMessage(error.message || "Delete failed.");
    } finally {
      setDeletingPdf("");
    }
  };

  const handleChat = async () => {
    if (isProcessingPdf) {
      setErrorMessage("PDF abhi process ho rahi hai. Please wait.");
      return;
    }

    if (!prompt.trim()) {
      setErrorMessage("Please enter a question.");
      return;
    }

    const activePdfName = selectedPdfName || pdfList[0] || null;

    if (!activePdfName) {
      setErrorMessage("Please upload and select a PDF first.");
      return;
    }

    const currentPrompt = prompt.trim();
    setErrorMessage("");
    setPrompt("");

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: currentPrompt,
        sources: [],
      },
    ]);

    try {
      setChatLoading(true);
      const data = await chatWithPDF(currentPrompt, activePdfName);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data?.answer || "No answer received from server.",
          sources: Array.isArray(data?.sources) ? data.sources : [],
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${error.message || "Chat request failed."}`,
          sources: [],
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const startPollingJobStatus = (currentJobId, uploadedPdfName) => {
    stopPolling();
    setIsProcessingPdf(true);
    setJobStatus("queued");

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const data = await getJobStatus(currentJobId);
        const state = data?.state || "unknown";
        setJobStatus(state);

        if (state === "completed") {
          stopPolling();
          setIsProcessingPdf(false);
          setUploadMessage("✅ PDF processing complete. you can now chat with it.");

          await loadPDFs(uploadedPdfName);

          setSelectedFile(null);
          setLastUploadedPdfName("");
          setJobId("");
          setJobStatus("");

          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        } else if (state === "failed") {
          stopPolling();
          setIsProcessingPdf(false);
          setErrorMessage("❌ PDF processing failed. Please upload again.");
        }
      } catch (error) {
        stopPolling();
        setIsProcessingPdf(false);
        setErrorMessage(error.message || "Polling failed while checking job status.");
      }
    }, 3000);
  };

  const handleThemeToggle = () => {
    setIsDark((prev) => !prev);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setErrorMessage("Please select a valid PDF file.");
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setSelectedFile(file);
    setErrorMessage("");
    setUploadMessage("");
    setJobId("");
    setJobStatus("");
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setErrorMessage("Please select a PDF first.");
      return;
    }

    try {
      const uploadedName = selectedFile.name;
      setLastUploadedPdfName(uploadedName);

      setUploading(true);
      setErrorMessage("");
      setUploadMessage("");
      setJobId("");
      setJobStatus("");

      const data = await uploadPDF(selectedFile);
      const newJobId = data?.jobId;

      setUploadMessage(data?.message || "PDF uploaded successfully.");
      if (!newJobId) {
        throw new Error("jobId not received from backend.");
      }

      setJobId(newJobId);
      startPollingJobStatus(newJobId, uploadedName);
    } catch (error) {
      setErrorMessage(error.message || "Upload failed.");
      setIsProcessingPdf(false);
      setLastUploadedPdfName("");
    } finally {
      setUploading(false);
    }
  };

  const suggestionPrompts = [
    "Explain Summary",
    "What are the key points?",
    "Explain important points",
    "Give a short overview of the PDF",
  ];

  const isChatDisabled = isProcessingPdf || uploading || chatLoading;
  const activePdfName = selectedPdfName || pdfList[0] || "";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-[#08090d] dark:text-white">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-0 top-0 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="absolute right-0 top-16 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-500/15" />
      </div>

      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl transition-colors duration-300 dark:border-white/10 dark:bg-black/30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-300/80">
              PDF RAG Chat
            </p>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
              Ask your documents instantly
            </h1>
          </div>

          <button
            onClick={handleThemeToggle}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-cyan-500 hover:bg-cyan-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-cyan-400/60 dark:hover:bg-cyan-400/10"
          >
            {isDark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <section className="relative overflow-hidden rounded-[28px] border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-violet-50 px-6 py-16 shadow-sm transition-colors duration-300 dark:border-cyan-400/20 dark:from-cyan-400/10 dark:via-transparent dark:to-violet-500/10 dark:shadow-[0_0_120px_rgba(51,231,255,0.08)]">
          <div className="max-w-3xl">
            <p className="mb-4 inline-flex rounded-full border border-cyan-300/50 bg-cyan-100 px-3 py-1 text-xs uppercase tracking-[0.3em] text-cyan-800 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-200">
              Turn dead PDFs into live answers
            </p>

            <h2 className="max-w-2xl text-4xl font-black leading-tight text-slate-900 sm:text-6xl dark:text-white">
              Upload once. Ask anything. Get the exact answer back.
            </h2>

            <p className="mt-5 max-w-xl text-base text-slate-600 sm:text-lg dark:text-white/70">
              Stop scrolling through long documents. Turn your PDF into an instant
              answer engine with one upload and one question.
            </p>
          </div>
        </section>

        <section className="mt-8 grid gap-8 lg:grid-cols-[380px_1fr]">
          <aside className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
            {/* 🚀 JET ANIMATION ADDED HERE */}
            {/* <div className="mb-6">
              <VectorSpace
                isProcessing={isProcessingPdf}
                isThinking={chatLoading}
                triggerSearch={chatLoading}
              />
            </div> */}
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300/80">
              Step 1
            </p>
            <h3 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
              Upload your PDF
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-white/60">
              Add one file, queue processing, then begin chatting with it.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || isProcessingPdf}
              className="mt-6 flex min-h-[180px] w-full items-center justify-center rounded-[24px] border border-dashed border-cyan-300 bg-cyan-50 p-6 text-center text-sm text-slate-600 transition hover:border-cyan-500 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-400/40 dark:bg-cyan-400/5 dark:text-white/70 dark:hover:border-cyan-300 dark:hover:bg-cyan-400/10"
            >
              {selectedFile ? selectedFile.name : "Click to choose a PDF"}
            </button>

            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading || isProcessingPdf}
              className="mt-4 w-full rounded-2xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400"
            >
              {uploading ? "Uploading..." : isProcessingPdf ? "Processing..." : "Upload and process"}
            </button>

            {jobId && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
                Job ID: {jobId}
                <br />
                Status: {jobStatus || "queued"}
              </div>
            )}

            {uploadMessage && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
                {uploadMessage}
              </div>
            )}

            {errorMessage && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
                {errorMessage}
              </div>
            )}
            <div className="mt-6 mb-4">
              <VectorSpace
                isProcessing={isProcessingPdf}
                isThinking={chatLoading}
                triggerSearch={chatLoading}
                isDark={isDark} // 📍 Pass the current theme state
              />
            </div>
            <div className="mt-8">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300/80">
                Uploaded PDFs
              </p>

              <div className="mt-3 space-y-3">
                {pdfList.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-white/50">
                    No PDFs uploaded yet.
                  </div>
                ) : (
                  pdfList.map((pdfName) => {
                    const isSelected = activePdfName === pdfName;

                    return (
                      <div
                        key={pdfName}
                        className={`flex items-center justify-between gap-3 rounded-2xl border p-3 transition ${isSelected
                          ? "border-cyan-400 bg-cyan-50 shadow-sm dark:border-cyan-400/60 dark:bg-cyan-400/10"
                          : "border-slate-200 bg-white dark:border-white/10 dark:bg-white/5"
                          }`}
                      >
                        <button
                          onClick={() => setSelectedPdfName(pdfName)}
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${isSelected
                              ? "border-cyan-500 bg-cyan-500 text-white dark:border-cyan-400 dark:bg-cyan-400 dark:text-black"
                              : "border-slate-300 text-slate-400 dark:border-white/15 dark:text-white/30"
                              }`}
                          >
                            {isSelected ? "✓" : ""}
                          </span>

                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800 dark:text-white">
                              {pdfName}
                            </p>
                            {isSelected && (
                              <p className="mt-1 text-xs text-cyan-700 dark:text-cyan-300">
                                Selected PDF
                              </p>
                            )}
                          </div>
                        </button>

                        <button
                          onClick={() => handleDeletePdf(pdfName)}
                          disabled={deletingPdf === pdfName}
                          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200"
                        >
                          {deletingPdf === pdfName ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          <section
            id="chat-panel"
            className="relative rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl"
          >
            {isProcessingPdf && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[24px] bg-white/85 p-6 backdrop-blur-sm dark:bg-black/70">
                <div className="max-w-md text-center">
                  <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-4 border-cyan-200 border-t-cyan-500 dark:border-cyan-900 dark:border-t-cyan-400" />
                  <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                    PDF processing in progress
                  </h4>
                  <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
                    ⏳ Reading the pdf and creating the vectors.
                    please wait 10-15 seconds...
                  </p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-white/50">
                    Current status: {jobStatus || "queued"}
                  </p>
                </div>
              </div>
            )}

            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-violet-700 dark:text-violet-300/80">
                  Step 2
                </p>
                <h3 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                  Chat with your PDF
                </h3>
                {activePdfName && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-white/60">
                    Selected: <span className="font-medium text-cyan-700 dark:text-cyan-300">{activePdfName}</span>
                  </p>
                )}
              </div>

              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
                {isProcessingPdf
                  ? "Processing PDF..."
                  : chatLoading
                    ? "Thinking..."
                    : "Ready"}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {suggestionPrompts.map((item) => (
                <button
                  key={item}
                  onClick={() => setPrompt(item)}
                  disabled={isChatDisabled}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 transition hover:border-cyan-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-cyan-400/60 dark:hover:bg-cyan-400/10"
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="mb-4 h-[420px] space-y-4 overflow-y-auto rounded-[20px] border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-black/20">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${msg.role === "user"
                    ? "ml-auto bg-cyan-500 text-white dark:bg-cyan-400 dark:text-black"
                    : "bg-white text-slate-900 shadow-sm dark:bg-white/8 dark:text-white"
                    }`}
                >
                  <p>{msg.content}</p>

                  {msg.sources?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.sources.map((source, i) => (
                        <span
                          key={i}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/70"
                        >
                          {typeof source === "string"
                            ? source
                            : source?.title ||
                            source?.source ||
                            JSON.stringify(source)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {chatLoading && (
                <div className="max-w-[85%] rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:bg-white/8 dark:text-white/70">
                  AI is generating an answer...
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isChatDisabled && handleChat()}
                placeholder={
                  isProcessingPdf
                    ? "PDF is processing... please wait"
                    : "Ask: tell me summary, what are the key points, etc."
                }
                disabled={isChatDisabled}
                className="h-14 flex-1 rounded-2xl border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-500 focus:shadow-[0_0_0_4px_rgba(34,211,238,0.12)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/35"
              />

              <button
                onClick={handleChat}
                disabled={isChatDisabled}
                className="h-14 rounded-2xl bg-cyan-500 px-6 text-sm font-semibold text-white shadow-lg transition hover:scale-[1.02] hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-400 dark:text-black"
              >
                {isProcessingPdf ? "Locked" : chatLoading ? "Sending..." : "Send"}
              </button>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}