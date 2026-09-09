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
# The seed template is 10pt and carries no escaped specials, so a bare prewarm
# leaves size11.clo/size12.clo and the TS1 (textcomp) fonts uncached — an 11pt
# or 12pt resume, or any resume containing & % $ # _ { } ~ ^ \, then fails under
# --only-cached. Render one document per offered font size containing the whole
# escape_latex output set, and compile each twice so the second proves the cache.
    && python -c "import pathlib; from app.importer import assemble_template, sanitize_style, build_resume_data; from app.resume import render_template_text; from app.builder import baseline_proposal; S = r'Escapes & % \$ # _ { } ~ ^ \\ done'; resume = build_resume_data({'identity': {'name': 'Prewarm Name', 'email': 'prewarm@example.com', 'phone': '+00 000', 'location': 'Nowhere'}, 'summary': 'Prewarm headline ' + S, 'experience': [{'company': 'Co', 'role': 'Role', 'location': 'Here', 'start': '2020', 'end': '2021', 'bullets': [S, 'A plain bullet.']}], 'projects': [{'name': 'Proj', 'url': 'https://example.com', 'technologies': ['T'], 'bullets': [S]}], 'education': [{'institution': 'Uni', 'degree': 'Deg', 'location': 'There', 'start': '2016', 'end': '2020', 'details': ['Detail']}], 'skills': [{'category': 'Cat', 'items': ['One', 'Two']}], 'achievements': [S], 'custom_sections': [{'title': 'Extra', 'bullets': [S]}]}); [pathlib.Path('/tmp/tectonic-prewarm/size-%s.tex' % z).write_text(render_template_text(assemble_template(sanitize_style({'font_size': z, 'accent_hex': '1F3A8A'})), resume, baseline_proposal(resume), sectioned=True), encoding='utf-8') for z in ('10pt', '11pt', '12pt')]" \
    && for size in 10pt 11pt 12pt; do \
         tectonic -X compile --untrusted --outdir /tmp/tectonic-prewarm \
           "/tmp/tectonic-prewarm/size-$size.tex" \
         && tectonic -X compile --untrusted --only-cached --outdir /tmp/tectonic-prewarm \
           "/tmp/tectonic-prewarm/size-$size.tex" || exit 1; \
       done \
    && rm -rf /tmp/tectonic-prewarm

EXPOSE 7860

# Shell form so the hosting platform's $PORT is honored (defaults to 7860).
CMD exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-7860}"
