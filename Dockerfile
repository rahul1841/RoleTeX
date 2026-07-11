FROM python:3.12-slim

ARG TARGETARCH
ARG TECTONIC_URL="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.16.9/tectonic-0.16.9-x86_64-unknown-linux-gnu.tar.gz"
ARG TECTONIC_SHA256="f3c825128095dc3399ea11c08c18035b33050a216930c295c79e8eb11bd21de4"

RUN if [ -n "$TARGETARCH" ] && [ "$TARGETARCH" != "amd64" ]; then \
      echo "This image pins the x86-64 Tectonic release; build with --platform linux/amd64." >&2; \
      exit 1; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       fontconfig \
       poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -fsSL "$TECTONIC_URL" -o /tmp/tectonic.tar.gz \
    && echo "$TECTONIC_SHA256  /tmp/tectonic.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic \
    && rm -f /tmp/tectonic.tar.gz \
    && tectonic --version

RUN useradd --create-home --uid 1000 --shell /usr/sbin/nologin user

ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TECTONIC_CACHE_DIR=/home/user/.cache/Tectonic \
    TECTONIC_UNTRUSTED_MODE=1 \
    PORT=7860

WORKDIR /home/user/app

COPY --chown=user:user requirements.txt ./
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt

COPY --chown=user:user . ./

USER user

# Render the structured baseline, then populate the package/font cache as the
# same UID used by Hugging Face at runtime. Compiling the raw token template is
# insufficient because LaTeX loads some font variants only after content is
# inserted. Production compiles use --only-cached, so a new template/package
# must be exercised here before it can be used by the running application.
RUN mkdir -p "$TECTONIC_CACHE_DIR" /tmp/tectonic-prewarm \
    && cp -R resume/assets /tmp/tectonic-prewarm/assets \
    && python -c "from pathlib import Path; from app.resume import ResumeRepository, flattened_skills, render_resume; from app.schemas import TailorProposal; resume, template = ResumeRepository().load(); proposal = TailorProposal(summary=resume.summary, bullet_rewrites=[], skills_order=flattened_skills(resume)); Path('/tmp/tectonic-prewarm/resume.tex').write_text(render_resume(template, resume, proposal), encoding='utf-8')" \
    && tectonic -X compile --untrusted \
       --outdir /tmp/tectonic-prewarm \
       /tmp/tectonic-prewarm/resume.tex \
    && tectonic -X compile --untrusted --only-cached \
       --outdir /tmp/tectonic-prewarm \
       /tmp/tectonic-prewarm/resume.tex \
    && rm -rf /tmp/tectonic-prewarm

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
