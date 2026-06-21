# Vendored OSCAL schema

`oscal_assessment-results_schema.json` is the **official, unmodified** NIST OSCAL
Assessment Results JSON Schema, vendored as the ground truth the parsimony OSCAL
projection validates against (`packages/parsimony/src/oscal.ts`, CLM-0174).

- **Source:** <https://github.com/usnistgov/OSCAL/releases/download/v1.1.3/oscal_assessment-results_schema.json>
- **Version:** OSCAL v1.1.3 (`$id` `http://csrc.nist.gov/ns/oscal/1.1.3/oscal-ar-schema.json`)
- **JSON Schema draft:** draft-07
- **License:** US Government work / public domain (NIST), per the usnistgov/OSCAL repo.

The file is checked in byte-for-byte as published; do not hand-edit it. The honesty
bar for #8 (#414) is that `toOscalAssessmentResults(...)` output validates against
THIS file via `ajv` in `src/oscal.test.ts` — if it stops validating, the projection
is wrong, not the schema.
