# Google Cloud Run setup

## 1. Google Cloud

Create a new Google Cloud project.

Enable:

- Cloud Run Admin API
- Cloud Build API
- Artifact Registry API
- IAM / Service Account APIs

Choose a region close to Europe, e.g. `europe-west1`.

## 2. GitHub authentication

Use Workload Identity Federation rather than storing a Google service-account
JSON key in GitHub.

Create:

- a deployer service account
- a Workload Identity Pool
- a GitHub OIDC provider

Grant the service account the permissions required to build/deploy Cloud Run.

GitHub secrets:

```text
GCP_PROJECT_ID
GCP_REGION
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_SERVICE_ACCOUNT
```

## 3. Backend runtime secrets

After the first Cloud Run deployment, configure:

```text
GROQ_API_KEY
GEMINI_API_KEY
GROQ_MODEL=openai/gpt-oss-120b
GEMINI_MODEL=gemini-3.7-flash
```

Do not put API keys in the repository.

## 4. Deploy

GitHub Actions includes:

`.github/workflows/deploy_backend.yml`

Run it manually from:

GitHub → Actions → Deploy Xoshi XI backend → Run workflow

The resulting URL will look like:

```text
https://xoshi-xi-backend-xxxxx.europe-west1.run.app
```

Test:

```text
https://YOUR-CLOUD-RUN-URL/health
```

It should report provider availability.

## 5. Connect the agent

Add this GitHub Secret:

```text
FASTAPI_URL=https://YOUR-CLOUD-RUN-URL
```

