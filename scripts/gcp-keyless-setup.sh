#!/usr/bin/env bash
# Keyless GitHub -> Chrome Web Store sign-in for wkoutre/keyline.
# Run in Cloud Shell (or any gcloud signed in as the project owner).
set -euo pipefail
PROJECT=keyline-cws
REPO=wkoutre/keyline
REPO_ID=1453383312          # pins the repo, so a deleted-and-recreated namesake can't match
ENVIRONMENT=chrome-web-store
SA=keyline-publisher

gcloud config set project "$PROJECT"
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com chromewebstore.googleapis.com

gcloud iam service-accounts create "$SA" --display-name="Keyline publisher (GitHub Actions)"

gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc keyline \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment' \
  --attribute-condition="assertion.repository_id=='${REPO_ID}' && assertion.ref=='refs/heads/main' && assertion.environment=='${ENVIRONMENT}'"

gcloud iam service-accounts add-iam-policy-binding "${SA}@${PROJECT}.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/${NUM}/locations/global/workloadIdentityPools/github/subject/repo:${REPO}:environment:${ENVIRONMENT}"

echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/${NUM}/locations/global/workloadIdentityPools/github/providers/keyline"
echo "GCP_SERVICE_ACCOUNT=${SA}@${PROJECT}.iam.gserviceaccount.com"
