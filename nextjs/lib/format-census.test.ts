import { describe, expect, it } from "vitest";

import { computeCensus, conditionLines, matrixLines, PATHS, realDeps, renderMarkdown, STRATA } from "../scripts/format-census.mjs";

/*
  The census is computed from the code, so this pins what the code does today. A change that adds,
  drops or re-codes an intake refusal changes a line here and has to be read, not waved through.
  Regenerate by running scripts/format-census.mjs and reading the diff against these arrays.
  Fixtures are synthetic; nothing here is a measured corpus result.
*/
const PINNED_MATRIX = [
  "1/pdf_text_layer/pdf upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "2/pdf_image_only/pdf upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "3/docx/docx upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "4/xlsx/xlsx upload=accepted_structure_lost archive=accepted_structure_lost source_agent=accepted_structure_lost connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_structure_lost connector_google_drive=accepted_structure_lost",
  "5/pptx/pptx upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "6/html/html upload=declared_withheld archive=declared_withheld source_agent=refused_typed:unsupported_file_type connector_dropbox=declared_withheld connector_microsoft_graph=declared_withheld connector_google_drive=declared_withheld",
  "6/html/htm upload=declared_withheld archive=declared_withheld source_agent=refused_typed:unsupported_file_type connector_dropbox=declared_withheld connector_microsoft_graph=declared_withheld connector_google_drive=declared_withheld",
  "7/subtitles/srt upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "7/subtitles/vtt upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "8/csv/csv upload=declared_withheld archive=declared_withheld source_agent=refused_typed:unsupported_file_type connector_dropbox=declared_withheld connector_microsoft_graph=declared_withheld connector_google_drive=declared_withheld",
  "9/plain_text_markdown/txt upload=declared_withheld archive=declared_withheld source_agent=refused_typed:unsupported_file_type connector_dropbox=declared_withheld connector_microsoft_graph=declared_withheld connector_google_drive=declared_withheld",
  "9/plain_text_markdown/md upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "10/raster_image/png upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "10/raster_image/jpg upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "10/raster_image/jpeg upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "10/raster_image/webp upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "10/raster_image/tif upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "10/raster_image/tiff upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "10/raster_image/gif upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "11/opendocument/odt upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "11/opendocument/ods upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "11/opendocument/odp upload=accepted_best_effort archive=accepted_best_effort source_agent=accepted_best_effort connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=accepted_best_effort connector_google_drive=accepted_best_effort",
  "12/legacy_macro_office/doc upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "12/legacy_macro_office/xls upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "12/legacy_macro_office/ppt upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "12/legacy_macro_office/docm upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "12/legacy_macro_office/xlsm upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "12/legacy_macro_office/pptm upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "13/hwp_family/hwp upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "13/hwp_family/hwpx upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "13/hwp_family/hml upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "14/email/eml upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "14/email/msg upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "15/archive/zip upload=refused_typed:UNQUALIFIED_MIME archive=not_computed:unmapped_status:UNSUPPORTED source_agent=refused_typed:unsupported_file_type connector_dropbox=refused_typed:UNQUALIFIED_MIME connector_microsoft_graph=refused_typed:UNQUALIFIED_MIME connector_google_drive=refused_typed:UNQUALIFIED_MIME",
  "15/archive/rar upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "15/archive/7z upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "16/everything_else/json upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "16/everything_else/exe upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "16/everything_else/mp4 upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "16/everything_else/bin upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "16/everything_else/svg upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
  "16/everything_else/rtf upload=absent archive=absent source_agent=refused_typed:unsupported_file_type connector_dropbox=absent connector_microsoft_graph=absent connector_google_drive=absent",
];

const PINNED_CONDITIONS = [
  "1/pdf/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "1/pdf/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "1/pdf/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "1/pdf/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "1/pdf/malformed_body not_refused_at_intake",
  "1/pdf/encrypted not_refused_at_intake",
  "1/pdf/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "1/pdf/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "2/pdf/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "2/pdf/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "2/pdf/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "2/pdf/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "2/pdf/malformed_body not_refused_at_intake",
  "2/pdf/encrypted not_refused_at_intake",
  "2/pdf/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "2/pdf/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "3/docx/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "3/docx/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "3/docx/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "3/docx/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "3/docx/malformed_body not_refused_at_intake",
  "3/docx/encrypted refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "3/docx/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "3/docx/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "4/xlsx/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "4/xlsx/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "4/xlsx/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "4/xlsx/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "4/xlsx/malformed_body not_refused_at_intake",
  "4/xlsx/encrypted refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "4/xlsx/over_pages not_refused_at_intake",
  "4/xlsx/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "5/pptx/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "5/pptx/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "5/pptx/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "5/pptx/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "5/pptx/malformed_body not_refused_at_intake",
  "5/pptx/encrypted refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "5/pptx/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "5/pptx/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "10/png/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "10/png/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/png/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "10/png/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/png/malformed_body not_refused_at_intake",
  "10/png/encrypted not_run:no_encrypted_form_defined_for_this_format",
  "10/png/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "10/png/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "10/jpg/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "10/jpg/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/jpg/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "10/jpg/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/jpg/malformed_body not_refused_at_intake",
  "10/jpg/encrypted not_run:no_encrypted_form_defined_for_this_format",
  "10/jpg/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "10/jpg/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "10/jpeg/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "10/jpeg/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/jpeg/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "10/jpeg/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/jpeg/malformed_body not_refused_at_intake",
  "10/jpeg/encrypted not_run:no_encrypted_form_defined_for_this_format",
  "10/jpeg/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "10/jpeg/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "10/tif/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "10/tif/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/tif/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "10/tif/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/tif/malformed_body not_refused_at_intake",
  "10/tif/encrypted not_run:no_encrypted_form_defined_for_this_format",
  "10/tif/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "10/tif/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "10/tiff/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "10/tiff/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/tiff/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "10/tiff/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/tiff/malformed_body not_refused_at_intake",
  "10/tiff/encrypted not_run:no_encrypted_form_defined_for_this_format",
  "10/tiff/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "10/tiff/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "10/gif/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "10/gif/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/gif/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "10/gif/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "10/gif/malformed_body not_refused_at_intake",
  "10/gif/encrypted not_run:no_encrypted_form_defined_for_this_format",
  "10/gif/over_pages refused_typed:SOURCE_EXCEEDS_PROCESSING_CEILING",
  "10/gif/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "11/odt/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "11/odt/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "11/odt/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "11/odt/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "11/odt/malformed_body not_refused_at_intake",
  "11/odt/encrypted not_refused_at_intake",
  "11/odt/over_pages not_refused_at_intake",
  "11/odt/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "11/ods/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "11/ods/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "11/ods/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "11/ods/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "11/ods/malformed_body not_refused_at_intake",
  "11/ods/encrypted not_refused_at_intake",
  "11/ods/over_pages not_refused_at_intake",
  "11/ods/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "11/odp/mime_mismatch refused_typed:FILENAME_MIME_MISMATCH",
  "11/odp/bad_magic_unrecognised refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "11/odp/bad_magic_wrong_family refused_typed:SOURCE_SIGNATURE_MISMATCH",
  "11/odp/truncated_header refused_typed:SOURCE_SIGNATURE_UNRECOGNISED",
  "11/odp/malformed_body not_refused_at_intake",
  "11/odp/encrypted not_refused_at_intake",
  "11/odp/over_pages not_refused_at_intake",
  "11/odp/over_bytes not_run:byte_check_is_inline_in_the_route_no_callable_function",
  "archive/baseline_expands expanded:1_member",
  "archive/encrypted refused_typed:ARCHIVE_ENCRYPTED",
  "archive/malformed_truncated refused_typed:ARCHIVE_DIRECTORY_MISSING",
  "archive/malformed_not_a_zip refused_typed:ARCHIVE_DIRECTORY_MISSING",
  "archive/path_traversal refused_typed:ARCHIVE_PATH_TRAVERSAL",
  "archive/nested_archive refused_typed:NESTED_ARCHIVE_NOT_ALLOWED",
  "archive/decompression_bomb refused_typed:DECOMPRESSION_BOMB_BLOCKED",
  "archive/too_many_files refused_typed:ARCHIVE_LIMIT_EXCEEDED",
  "archive/over_size_archive refused_typed:ARCHIVE_TOO_LARGE",
];

const mutate = (patch: Record<string, unknown>) => ({ ...realDeps, ...patch }) as unknown as typeof realDeps;

const VERDICT = /^(accepted_best_effort|accepted_structure_lost|declared_withheld|absent|refused_typed:.+|not_computed:.+|not_run:.+)$/;

describe("format census", () => {
  it("matches the pinned verdict matrix and condition outcomes over the current tree", async () => {
    const census = await computeCensus();
    expect(matrixLines(census)).toEqual(PINNED_MATRIX);
    expect(conditionLines(census)).toEqual(PINNED_CONDITIONS);
  });

  it("covers the 15 strata plus everything else, and every verdict is in the vocabulary with its denominator", async () => {
    const census = await computeCensus();
    expect(census.strata.map((s: { id: number }) => s.id)).toEqual(STRATA.map((s) => s.id));
    expect(census.strata).toHaveLength(16);
    for (const stratum of census.strata) for (const row of stratum.rows) {
      for (const path of PATHS) expect((row.paths as Record<string, { verdict: string }>)[path].verdict).toMatch(VERDICT);
    }
    for (const path of PATHS) {
      const { denominator_extension_probes: n, counts } = census.summary[path];
      expect(Object.values(counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(n);
    }
    expect(renderMarkdown(census)).toContain(census.foundationSha);
  });

  it("stops when a validator refuses without a code, instead of recording a soft verdict", async () => {
    const dropped = mutate({ validateInput: () => ({ valid: false }) });
    await expect(computeCensus(dropped)).rejects.toThrow("CENSUS_REFUSAL_WITHOUT_CODE");
  });

  it("a mutation that silently drops the signature refusal changes the pinned conditions", async () => {
    const mutated = mutate({ verifySignature: () => ({ ok: true, family: "pdf" }) });
    expect(conditionLines(await computeCensus(mutated))).not.toEqual(PINNED_CONDITIONS);
  });

  it("a mutation that accepts every archive changes the pinned archive conditions", async () => {
    const mutated = mutate({ expand: () => [] });
    expect(conditionLines(await computeCensus(mutated))).not.toEqual(PINNED_CONDITIONS);
  });

  it("reports not_computed, never a verdict, when the agent and route sources cannot be read", async () => {
    const census = await computeCensus(mutate({ readText: () => "" }));
    for (const stratum of census.strata) for (const row of stratum.rows) {
      expect(row.paths.source_agent.verdict).toMatch(/^not_computed:/);
      for (const c of Object.values(row.conditions?.upload ?? {}) as Array<{ via: string; outcome: string }>) {
        if (c.via === "route_source_text") expect(c.outcome).toMatch(/^not_computed:/);
      }
    }
  });

  it("reports a fixture baseline that the real signature check refuses as an error, not a row", async () => {
    const mutated = mutate({ verifySignature: () => ({ ok: false, code: "SOURCE_SIGNATURE_UNRECOGNISED" }) });
    await expect(computeCensus(mutated)).rejects.toThrow("CENSUS_FIXTURE_BASELINE_REFUSED");
  });

  it("Dropbox verdicts come from the real list reader: it lists no MIME, so no extension is qualified", async () => {
    const census = await computeCensus();
    for (const stratum of census.strata) for (const row of stratum.rows) {
      expect((row.paths.connector_dropbox as { listedMimeType?: unknown }).listedMimeType).toBeNull();
      expect(row.paths.connector_dropbox.verdict).not.toMatch(/^accepted/);
    }
    const pdf = census.strata[0].rows[0].paths;
    expect(pdf.connector_dropbox.verdict).toBe("refused_typed:UNQUALIFIED_MIME");
    expect(pdf.connector_microsoft_graph.verdict).toBe("accepted_best_effort");
    expect(pdf.connector_google_drive.verdict).toBe("accepted_best_effort");
  });

  it("a list reader that does hand back a MIME changes the connector verdict (not typed by hand)", async () => {
    const withMime = mutate({
      listSource: async (input: Parameters<typeof realDeps.listSource>[0]) => {
        const page = await realDeps.listSource(input);
        return { ...page, items: page.items.map((item: { name: string }) => ({ ...item, mimeType: "application/pdf" })) };
      },
    });
    const pdf = (await computeCensus(withMime)).strata[0].rows[0].paths;
    expect(pdf.connector_dropbox.verdict).toBe("accepted_best_effort");
  });

  it("a provider whose list reader fails is not_computed for every row, never a verdict", async () => {
    const census = await computeCensus(mutate({ listGoogle: async () => { throw new Error("DRIVE_REQUEST_FAILED"); } }));
    for (const stratum of census.strata) for (const row of stratum.rows) {
      expect(row.paths.connector_google_drive.verdict).toBe("not_computed:connector_list_failed:DRIVE_REQUEST_FAILED");
    }
  });

  it("the zip container verdict is the manifest row's, and expansion is a separate field outside the verdict counts", async () => {
    const census = await computeCensus();
    const [zip, rar, sevenZ] = census.strata.find((s: { id: number }) => s.id === 15)!.rows;
    expect(zip.paths.archive.verdict).toBe("not_computed:unmapped_status:UNSUPPORTED");
    expect((zip.paths.archive as { expansion?: string }).expansion).toBe("expanded:1_member");
    expect((census.summary.archive.counts as Record<string, number>).accepted_best_effort).toBe(13);
    expect(JSON.stringify(census.summary.archive.counts)).not.toContain("expanded");
    expect(rar.paths.archive.verdict).toBe("absent");
    expect(sevenZ.paths.archive.verdict).toBe("absent");
  });

  it("rar and 7z are judged by the real selection function: a selection that stages one is not a refusal", async () => {
    const staged = mutate({
      prepareSelection: async (files: File[]) => ({ files: files.map((file) => ({ file, relativePath: file.name })), unsupported: [], warnings: [], archiveCount: 0 }),
    });
    const census = await computeCensus(staged);
    const [, rar] = census.strata.find((s: { id: number }) => s.id === 15)!.rows;
    expect(rar.paths.archive.verdict).not.toBe("absent");
    const none = await computeCensus(mutate({ prepareSelection: async () => ({ files: [], unsupported: [], warnings: [], archiveCount: 0 }) }));
    expect(none.strata.find((s: { id: number }) => s.id === 15)!.rows[1].paths.archive.verdict).toBe("not_computed:container_neither_expanded_nor_skipped");
  });
});
