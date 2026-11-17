"""Research-only FastAPI service; disabled until separate credentials and weights exist."""
import asyncio
import hmac
import os
import threading
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from .contracts import Query, validate_answer
from .runtime import ModelRunner, safety_intercept


def create_app(runner=None, api_key=None):
    key = os.environ.get('HBM_API_KEY', '') if api_key is None else api_key
    state = {'runner': runner, 'startup': 'not_configured'}
    busy = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        if state['runner'] is None and os.environ.get('HBM_MODEL_DIR') and len(key) >= 24:
            try:
                state['runner'] = await asyncio.to_thread(ModelRunner, os.environ.get('HBM_CONFIG', 'configs/llama3-8b-qlora.json'), os.environ['HBM_MODEL_DIR'])
            except Exception:
                state['startup'] = 'model_load_failed'
        if state['runner'] is not None:
            state['startup'] = 'ready'
        yield

    app = FastAPI(title='HealthBrowse Model Lab — research only', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def body_limit(request: Request, call_next):
        # Enforce actual streamed bytes, including requests without Content-Length.
        total = 0
        chunks = []
        async for chunk in request.stream():
            total += len(chunk)
            if total > 100000:
                return JSONResponse({'detail': 'Research request too large'}, status_code=413)
            chunks.append(chunk)
        request._body = b''.join(chunks)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response

    def authenticated(authorization: str = Header(default='')):
        if len(key) < 24:
            raise HTTPException(503, 'Separate research API key is not configured')
        if not hmac.compare_digest(authorization.encode(), ('Bearer ' + key).encode()):
            raise HTTPException(401, 'Invalid research API credential')

    @app.get('/healthz')
    def health():
        ready = state['runner'] is not None and len(key) >= 24
        return JSONResponse({'service': 'healthbrowse-model-lab', 'ready': ready, 'production_routing': False,
                             'status': state['startup']}, status_code=200 if ready else 503)

    @app.post('/v1/answer', dependencies=[Depends(authenticated)])
    def answer(query: Query):
        if state['runner'] is None:
            raise HTTPException(503, 'No separate trained research model is loaded')
        if not busy.acquire(blocking=False):
            raise HTTPException(429, 'Research GPU is busy; retry after the current request')
        try:
            result = safety_intercept(query) or state['runner'].answer(query)
            result = validate_answer(result.model_dump() if hasattr(result, 'model_dump') else result, query)
        except (ValueError, KeyError, TypeError):
            raise HTTPException(422, 'Model output or context failed the research contract; no unchecked answer is returned')
        except Exception:
            raise HTTPException(503, 'Research model inference failed')
        finally:
            busy.release()
        return {'model': 'HealthBrowse-Med-Research', 'research_only': True, 'verification': 'Schema and source quotes checked; semantic and clinical support not independently validated', 'response': result.model_dump()}

    return app

app = create_app()
