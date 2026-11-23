# GPU research runtime; build/run explicitly. This is not a production release.
FROM python:3.12-slim
WORKDIR /lab
COPY pyproject.toml ./
COPY hb_model_lab ./hb_model_lab
RUN pip install --no-cache-dir '.[train]' && useradd --create-home researcher
COPY configs ./configs
USER researcher
EXPOSE 8011
CMD ["uvicorn", "hb_model_lab.api:app", "--host", "0.0.0.0", "--port", "8011", "--no-access-log"]
