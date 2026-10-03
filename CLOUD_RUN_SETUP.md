# Xoshi XI — Google Cloud Run setup

## 1. Create a Google Cloud project
Enable:
- Cloud Run Admin API
- Cloud Build API
- Artifact Registry API
- IAM / Service Account Credentials as required

## 2. Create a service account
Create a deployer service account and configure GitHub Actions authentication
using Workload Identity Federation. Do not put a Google service-account JSON
key in the repository.

## 3. GitHub secrets

Add:
- GCP_PROJECT_ID
- GCP_REGION (for example europe-west1)
- GCP_WORKLOAD_IDENTITY_PROVIDER
- GCP_SERVICE_ACCOUNT

The backend also needs runtime secrets:
- GROQ_API_KEY
- GEMINI_API_KEY

Set those on the Cloud Run service, not in Git.

## 4. Deploy

Run the workflow `Deploy Xoshi XI backend to Cloud Run` manually, or push a
change under `backend/`.

## 5. Connect the X agent

After Cloud Run gives you the HTTPS service URL, set:

FASTAPI_URL=https://YOUR-CLOUD-RUN-URL

as the GitHub Actions secret used by the Xoshi cycle.

## Architecture

GitHub Actions -> Playwright/X profile -> X
                       |
                       v
                 Cloud Run FastAPI
                    /       \
                 Groq       Gemini

Cloud Run is stateless. X account browser profiles and credentials remain
outside the public repository.
