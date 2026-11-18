# Callnote Companion

Build a mobile-first web application called FieldIQ Pharma, an AI-assisted field reporting tool for pharmaceutical medical representatives.

Purpose: Help medical representatives convert their post-visit notes into accurate, structured doctor-call reports without manually filling out every field.

Users

Medical representatives and hierarchy managers sign in through Supabase Auth. Server functions resolve the active MR profile and organization scope; all bundled and local seed data is synthetic.

Screens

Home dashboard showing total calls, drafts awaiting approval, approved reports and follow-ups due.

New Call Report with a text input where an MR can describe a completed doctor visit in natural language.

Review Draft displaying extracted information in an editable form.

Call History with search and filters by date, doctor and status.

Follow-ups showing upcoming follow-up tasks.

Call report fields

Call date and time

Doctor ID and doctor name

Specialty and clinic, if available in the fictional master data

Products discussed

Purpose of visit

Doctor feedback and questions

Materials or information requested

Follow-up action and due date

Original MR note

Draft or approved status

AI behaviour

Convert the MR's note into structured fields.

Match doctor and product names against the available fictional master data.

If multiple doctors or products match, ask the user to choose.

If a required field is missing or ambiguous, ask a concise clarification question.

Never invent doctor identities, products, feedback, dates or numerical values.

Clearly distinguish unknown information from confirmed information.

Present an editable draft before saving it as approved.

Preserve the original note for audit purposes.

Data and controls

Use fictional demo doctors and products.

Save approved records and their status persistently.

Include a CSV export for approved reports.

Track creation time, approval time and edits.

Do not include patient-level data.

Do not connect to a real pharmaceutical CRM or portal.

Keep API secrets out of browser-side code.

Build the simplest functional version first, not a collection of mockup screens.

Design

Use a clean, professional pharmaceutical-business interface, large mobile-friendly controls, minimal typing and a clear voice-input placeholder for future development. Make the review and approval process especially easy to use on a phone.

First, propose the data model and implementation plan. Then build the working prototype in small, testable steps.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://callnote-companion.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5e224f47-05d5-5645-8819-064f5fc81a9c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
