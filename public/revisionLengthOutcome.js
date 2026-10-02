(function (root) {
  function revisionLengthOutcome(data, formatNumber = (value) => Number(value).toLocaleString()) {
    const reasons = data.output_acceptance?.reasons || [];
    const sourceWords = data.output_acceptance?.dimensions?.source_word_count;
    const candidateWords = data.output_acceptance?.dimensions?.candidate_word_count;
    const evidence = Number.isFinite(sourceWords) && Number.isFinite(candidateWords)
      ? ` Source ${formatNumber(sourceWords)} words → candidate ${formatNumber(candidateWords)} words.` : "";
    const contract = data.length_contract?.mode === "expand" ? data.length_contract : null;
    const missedExpansion = contract && (contract.satisfied === false || reasons.includes("expand_length_contract_missed"));
    if (missedExpansion) {
      const addition = Number.isFinite(sourceWords) && Number.isFinite(candidateWords) ? candidateWords - sourceWords : contract.actual_addition_words;
      const change = Number.isFinite(addition)
        ? addition < 0 ? ` It shortened the source by ${formatNumber(-addition)} words.` : ` It added ${formatNumber(addition)} words.` : "";
      const minimum = contract.minimum_addition_words ?? 200;
      const deficit = Number.isFinite(addition) ? ` ${formatNumber(Math.max(0, minimum - addition))} more words are needed.` : "";
      return `Expand failed to meet the requested minimum +${formatNumber(minimum)} words.${evidence}${change}${deficit} The complete draft is available for review, not a completed expansion. No further automatic paid retry was launched.`;
    }
    if (reasons.includes("deep_auto_developmental_compression")) return `The revision shortened the source despite no shortening being selected.${evidence} The complete draft is available for review; the requested development was not completed.`;
    if (data.candidate_verdict?.final_status === "accepted") {
      const added = Number.isFinite(sourceWords) && Number.isFinite(candidateWords) ? candidateWords - sourceWords : contract?.actual_addition_words;
      return `Revision completed and internally cleared.${contract?.satisfied ? ` Expand contract met: +${formatNumber(added)} words (minimum +${formatNumber(contract.minimum_addition_words)}).` : ""}`;
    }
    return `Complete candidate returned for researcher review; it has not been labelled as an internally cleared final revision.${evidence}`;
  }
  root.VoiceEngineRevisionLength = { revisionLengthOutcome };
})(typeof window !== "undefined" ? window : globalThis);
