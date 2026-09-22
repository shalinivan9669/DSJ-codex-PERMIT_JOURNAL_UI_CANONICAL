"""Trusted entrypoint for Python isolated mode (-I); never resolve cwd imports."""
import sys
import os
from pathlib import Path
if os.name=='posix':
    import resource
    resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3))
    resource.setrlimit(resource.RLIMIT_CPU,(150,150))
    resource.setrlimit(resource.RLIMIT_FSIZE,(120*1024**2,120*1024**2))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from renderer import main
if __name__=='__main__':
    try: main()
    except Exception as error:
        import json
        print(json.dumps({'error':str(error) if isinstance(error,ValueError) else type(error).__name__}),file=sys.stderr)
        sys.exit(1)
