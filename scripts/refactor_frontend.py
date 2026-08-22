import os
import re

def extract_braces(text, start_index):
    brace_count = 0
    in_string = False
    string_char = ''
    i = start_index
    
    while i < len(text):
        c = text[i]
        if c in ['"', "'", '`'] and (i == 0 or text[i-1] != '\\'):
            if not in_string:
                in_string = True
                string_char = c
            elif string_char == c:
                in_string = False
                
        if not in_string:
            if c == '{':
                brace_count += 1
            elif c == '}':
                brace_count -= 1
                if brace_count == 0:
                    return text[start_index:i+1], i+1
        i += 1
    return "", -1

def main():
    impl_path = "src/preview/ops/implementation.ts"
    with open(impl_path, "r", encoding="utf-8") as f:
        content = f.read()

    match = re.search(r'export const ops\s*=\s*\{', content)
    if not match:
        print("ops object not found")
        return

    # ops starts at match.end() - 1
    ops_start = match.end() - 1
    ops_block, ops_end = extract_braces(content, ops_start)
    
    print(f"Extracted ops block of size {len(ops_block)}")
    
    # Very naive regex to find function keys inside the object:
    # colorAjust(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    func_pattern = re.compile(r'^\s*([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{', re.MULTILINE)
    
    color_funcs = ["colorAjust", "colorCorrect", "levels", "hueSat", "desaturate", "invert", "clamp", "channel", "lumaKey", "sharpen", "edgeDetect", "glow"]
    
    extracted_code = ""
    for m in func_pattern.finditer(ops_block):
        func_name = m.group(1)
        if func_name in color_funcs:
            print(f"Extracting {func_name}...")
            # We need to find the full body of the function
            start_idx = m.start()
            brace_idx = ops_block.find('{', start_idx)
            func_body, _ = extract_braces(ops_block, brace_idx)
            
            # Reconstruct function
            # the matched string m.group(0) ends with {
            sig = ops_block[start_idx:brace_idx]
            extracted_code += f"export function {sig.strip()}{func_body[1:]}\n\n"
            
    if extracted_code:
        out_path = "src/preview/ops/color.ts"
        print(f"Writing to {out_path}...")
        # read existing
        if os.path.exists(out_path):
            with open(out_path, "r", encoding="utf-8") as f:
                existing = f.read()
            # replace ops references with actual functions
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(existing + "\n\n" + extracted_code)
        
    print("Done proof of concept extraction.")

if __name__ == "__main__":
    main()
