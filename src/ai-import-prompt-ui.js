(function () {
  "use strict";
  const field = document.querySelector("#aiImportPrompt");
  const copyButton = document.querySelector("#copyAiImportPrompt");
  const downloadButton = document.querySelector("#downloadAiImportPrompt");
  const status = document.querySelector("#aiImportPromptStatus");
  field.value = PatternImportPrompt.text;

  copyButton.addEventListener("click", async () => {
    copyButton.disabled = true;
    status.textContent = "";
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = "Prompt copie.";
    } catch {
      field.focus({ preventScroll: true });
      field.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* Leave the prompt selected for manual copy. */ }
      status.textContent = copied ? "Prompt copie." : "Copie automatique indisponible. Texte selectionne.";
      if (copied) copyButton.focus({ preventScroll: true });
    } finally { copyButton.disabled = false; }
  });

  downloadButton.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([field.value], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "conversion-pdf-cross-stitch.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Telechargement du prompt lance.";
  });
})();
