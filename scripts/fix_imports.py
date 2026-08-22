import re
import os
from pathlib import Path

def main():
    root = Path(__file__).resolve().parent.parent / "src" / "preview" / "ops"
    impl_path = root / "implementation.ts"
    
    if not impl_path.exists():
        print("implementation.ts not found")
        return

    # 1. Find all exported functions in implementation.ts
    impl_text = impl_path.read_text("utf-8")
    # Matches `export function foo(` or `export const foo =`
    funcs = set()
    for match in re.finditer(r'export\s+(?:function|const)\s+([a-zA-Z0-9_]+)\s*(?:=|\()', impl_text):
        funcs.add(match.group(1))
    
    # 2. For each extracted TS file, replace the `import * as impl` with named imports
    targets = ["geometry.ts", "blend.ts", "masks.ts", "procedural.ts", "video.ts"]
    for target in targets:
        target_path = root / target
        if not target_path.exists():
            continue
            
        text = target_path.read_text("utf-8")
        
        # Find which functions are actually used in this file
        used_funcs = []
        for func in sorted(funcs):
            # Check if func is used as a word (not as a substring)
            if re.search(r'\b' + re.escape(func) + r'\b', text):
                used_funcs.append(func)
                
        if not used_funcs:
            continue
            
        import_stmt = "import {\n    " + ",\n    ".join(used_funcs) + "\n} from \"./implementation.js\";"
        
        # Replace the `import * as impl from "./implementation.js";`
        text = re.sub(r'import\s+\*\s+as\s+impl\s+from\s+"./implementation\.js";', import_stmt, text)
        
        # Remove duplicate `import { ops } from "./implementation.js";`
        text = re.sub(r'import\s+{\s*ops\s*}\s+from\s+"./implementation\.js";\n?', '', text)
        
        # Add types
        if "RenderInputInfo" in text and "RenderInputInfo" not in text[:200]:
            text = text.replace('import type { ComfyNode } from "../../types.js";', 'import type { ComfyNode, RenderInputInfo } from "../../types.js";')
        
        if "setWidgetValue" in text and "setWidgetValue" not in text[:200]:
            text = 'import { setWidgetValue } from "../shared/widgets.js";\n' + text
            
        if "renderDrawPreview" in text and "renderDrawPreview" not in text[:200]:
            text = 'import { renderDrawPreview, resolveDrawOverlayCanvas } from "../draw.js";\n' + text
            
        target_path.write_text(text, "utf-8")
        print(f"Fixed imports for {target}")

if __name__ == "__main__":
    main()
