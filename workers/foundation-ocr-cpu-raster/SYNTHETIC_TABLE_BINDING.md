# Synthetic table binding contract

This test fixture is drawn from scratch. The test generates a one-page PDF
containing an empty ruled grid, with no customer document or text. The test
supplies thirteen invented OCR labels and polygons; it stubs rendering and
recognition while the real PDF parser reads the synthetic PDF bytes.

The profile is pinned to that PDF, page zero, displayed dimensions and the
synthetic OCR region fingerprint. Header and two complete rows reorder within
the bounded grid. An incomplete final row and the two outside regions retain
their input slots. Negative cases refuse an unknown PDF, extra page, altered
profile, changed OCR text or confidence, and wrong page. The ordinary
unprofiled extraction path and HTTP handler remain unchanged.

This is a caller and safety contract, not an OCR accuracy benchmark, source
glyph determination, semantic table DTO or permission to redistribute any
separate drawing. The synthetic PDF/profile and test have no production
activation path. Docker still copies only `app.py`.
