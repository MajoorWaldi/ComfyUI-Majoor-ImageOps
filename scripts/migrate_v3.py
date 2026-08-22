import ast
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def format_input(name, spec, is_optional):
    raw_type = spec[0] if isinstance(spec, (tuple, list)) and spec else "STRING"
    opts = spec[1] if isinstance(spec, (tuple, list)) and len(spec) > 1 and isinstance(spec[1], dict) else {}
    
    type_str = "String"
    if isinstance(raw_type, (list, tuple)) and not isinstance(raw_type, str):
        options_str = repr(list(raw_type))
        kwargs_str = ", ".join(f"{k}={repr(v)}" for k, v in opts.items())
        if kwargs_str:
            kwargs_str = ", " + kwargs_str
        return f'io.String.Input("{name}", options={options_str}{kwargs_str})'
        
    type_name = str(raw_type).upper()
    if type_name == "IMAGE,VIDEO":
        type_str = "MultiType"
    elif type_name == "COLOR" or ("COLOR" in name.lower() and type_name == "STRING"):
        type_str = "Color"
    elif type_name in {"BOOLEAN", "BOOL"}:
        type_str = "Boolean"
    elif type_name == "INT":
        type_str = "Int"
    elif type_name == "FLOAT":
        type_str = "Float"
    elif type_name == "MASK":
        type_str = "Mask"
    elif "IMAGE" in type_name or "VIDEO" in type_name:
        type_str = "Image"
        
    kwargs_str = ""
    for k, v in opts.items():
        if k == "extra_dict" and type_str in ("Image", "Video", "Mask", "MultiType"):
            kwargs_str += f", extra_dict={repr(v)}"
        elif k == "display":
            kwargs_str += f", display_mode=io.NumberDisplay({repr(v)})"
        elif k == "forceInput":
            kwargs_str += f", force_input={repr(v)}"
        else:
            kwargs_str += f", {k}={repr(v)}"
            
    if is_optional:
        kwargs_str += ", optional=True"
        
    if type_str == "MultiType":
        return f'io.MultiType.Input("{name}", types=[io.Image, io.Video]{kwargs_str})'
    return f'io.{type_str}.Input("{name}"{kwargs_str})'


class NodeMigrator(ast.NodeTransformer):
    def __init__(self, node_id, display_name):
        self.node_id = node_id
        self.display_name = display_name
        self.modified = False
        
        # We will parse these from the legacy class attributes
        self.function_name = "apply"
        self.category = "image/imageops"
        self.return_types = []
        self.return_names = []
        self.inputs_dict = {"required": {}, "optional": {}, "hidden": {}}

    def extract_dict_from_ast(self, dict_node):
        """Very basic AST to dict converter for INPUT_TYPES"""
        result = {}
        if not isinstance(dict_node, ast.Dict):
            return result
        for k, v in zip(dict_node.keys, dict_node.values):
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                if isinstance(v, ast.Tuple) or isinstance(v, ast.List):
                    # Tuple (TYPE, {options})
                    elements = v.elts
                    spec = []
                    if len(elements) > 0:
                        if isinstance(elements[0], ast.Constant):
                            spec.append(elements[0].value)
                        elif isinstance(elements[0], ast.Name):
                            # like _BLUR_TYPES, just use string repr for now, we'll fix it manually later if needed
                            # actually we can just output it as raw type
                            spec.append(elements[0].id)
                        else:
                            spec.append("STRING")
                            
                    if len(elements) > 1 and isinstance(elements[1], ast.Dict):
                        opts = {}
                        for dk, dv in zip(elements[1].keys, elements[1].values):
                            if isinstance(dk, ast.Constant) and isinstance(dk.value, str):
                                if isinstance(dv, ast.Constant):
                                    opts[dk.value] = dv.value
                                elif isinstance(dv, ast.UnaryOp) and isinstance(dv.op, ast.USub) and isinstance(dv.operand, ast.Constant):
                                    opts[dk.value] = -dv.operand.value
                        spec.append(opts)
                    result[k.value] = spec
                elif isinstance(v, ast.Dict):
                    result[k.value] = self.extract_dict_from_ast(v)
                elif isinstance(v, ast.Constant):
                    result[k.value] = v.value
        return result

    def generate_schema_code(self):
        inputs_code = []
        required = self.inputs_dict.get("required", {})
        optional = self.inputs_dict.get("optional", {})
        hidden = self.inputs_dict.get("hidden", {})
        
        for name, spec in required.items():
            if not isinstance(spec, (list, tuple)): spec = [spec]
            inputs_code.append("            " + format_input(name, spec, False) + ",")
        for name, spec in optional.items():
            if not isinstance(spec, (list, tuple)): spec = [spec]
            inputs_code.append("            " + format_input(name, spec, True) + ",")
            
        outputs_code = []
        for index, output_type in enumerate(self.return_types):
            name = self.return_names[index] if index < len(self.return_names) else f"output_{index + 1}"
            type_name = str(output_type).upper()
            type_str = "String"
            if type_name == "MASK": type_str = "Mask"
            elif "IMAGE" in type_name or "VIDEO" in type_name: type_str = "Image"
            elif type_name == "INT": type_str = "Int"
            elif type_name == "FLOAT": type_str = "Float"
            elif type_name in {"BOOLEAN", "BOOL"}: type_str = "Boolean"
            outputs_code.append(f'            io.{type_str}.Output("{name}", display_name="{name}"),')
            
        hidden_code = []
        for name in hidden:
            hidden_code.append(f"io.Hidden.{name}")
        hidden_str = f",\n        hidden=[{', '.join(hidden_code)}]" if hidden_code else ""
        
        return f"""@classmethod
def define_schema(cls) -> io.Schema:
    return io.Schema(
        node_id="{self.node_id}",
        display_name="{self.display_name}",
        category="{self.category}",
        inputs=[
{chr(10).join(inputs_code)}
        ],
        outputs=[
{chr(10).join(outputs_code)}
        ]{hidden_str}
    )
"""

    def visit_ClassDef(self, node):
        if not node.name.startswith("ImageOps"):
            return node
            
        # Already migrated?
        has_define_schema = any(isinstance(n, ast.FunctionDef) and n.name == "define_schema" for n in node.body)
        if has_define_schema:
            return node
            
        self.modified = True
        
        # Modify bases to inherit from io.ComfyNode
        if not any(isinstance(b, ast.Attribute) and b.value.id == "io" and b.attr == "ComfyNode" for b in node.bases):
            node.bases = [ast.parse("io.ComfyNode").body[0].value]
            
        # Extract metadata
        for child in node.body:
            if isinstance(child, ast.Assign):
                targets = [t.id for t in child.targets if isinstance(t, ast.Name)]
                if "CATEGORY" in targets and isinstance(child.value, ast.Constant):
                    self.category = child.value.value
                elif "FUNCTION" in targets and isinstance(child.value, ast.Constant):
                    self.function_name = child.value.value
                elif "RETURN_TYPES" in targets and isinstance(child.value, ast.Tuple):
                    self.return_types = [e.value for e in child.value.elts if isinstance(e, ast.Constant)]
                elif "RETURN_NAMES" in targets and isinstance(child.value, ast.Tuple):
                    self.return_names = [e.value for e in child.value.elts if isinstance(e, ast.Constant)]
            
            if isinstance(child, ast.FunctionDef) and child.name == "INPUT_TYPES":
                # Find return dictionary
                for stmt in child.body:
                    if isinstance(stmt, ast.Return) and isinstance(stmt.value, ast.Dict):
                        self.inputs_dict = self.extract_dict_from_ast(stmt.value)
                        
        # Now remove legacy attributes and inject schema
        new_body = []
        for child in node.body:
            if isinstance(child, ast.Assign):
                targets = [t.id for t in child.targets if isinstance(t, ast.Name)]
                if any(t in {"CATEGORY", "RETURN_TYPES", "RETURN_NAMES", "FUNCTION"} for t in targets):
                    continue
            if isinstance(child, ast.FunctionDef):
                if child.name == "INPUT_TYPES":
                    # inject define_schema
                    schema_code = self.generate_schema_code()
                    schema_ast = ast.parse(schema_code).body[0]
                    new_body.append(schema_ast)
                    continue
                if child.name == self.function_name:
                    # Rename function to execute, make it classmethod, replace self with cls
                    child.name = "execute"
                    if not any(isinstance(d, ast.Name) and d.id == "classmethod" for d in child.decorator_list):
                        child.decorator_list.insert(0, ast.Name(id="classmethod", ctx=ast.Load()))
                    if child.args.args and child.args.args[0].arg == "self":
                        child.args.args[0].arg = "cls"
                    
                    class SelfReplacer(ast.NodeTransformer):
                        def visit_Name(self, n):
                            if n.id == "self":
                                n.id = "cls"
                            return n
                    child = SelfReplacer().visit(child)
            new_body.append(child)
            
        node.body = new_body
        return node


def process_file(filepath):
    content = filepath.read_text("utf-8")
    
    if "io.Schema" in content:
        return
        
    class_match = re.search(r"class (ImageOps[A-Za-z]+)(?:\(\w+\))?:", content)
    if not class_match:
        return
    class_name = class_match.group(1)
    
    display_name = re.sub(r"(?<!^)(?=[A-Z])", " ", class_name).strip()
    display_name = display_name.replace("Ajust", "Color Correct").strip()
    display_name = "〽️ " + display_name
    
    try:
        tree = ast.parse(content)
    except Exception as e:
        print(f"Error parsing {filepath.name}: {e}")
        return
        
    migrator = NodeMigrator(class_name, display_name)
    new_tree = migrator.visit(tree)
    
    if not migrator.modified:
        return
        
    # Unparse code
    new_content = ast.unparse(new_tree)
    
    # Add imports
    if "from comfy_api.latest import io" not in new_content and "import io" not in new_content:
        if "from __future__ import annotations" in new_content:
            new_content = new_content.replace("from __future__ import annotations", "from __future__ import annotations\nfrom comfy_api.latest import io")
        else:
            new_content = "from comfy_api.latest import io\n" + new_content
        
    # Fix variables that got quoted by AST extraction
    new_content = re.sub(r'options="(_[A-Z_]+)"', r'options=\1', new_content)
    new_content = re.sub(r'types=\[\'io.Image\', \'io.Video\'\]', r'types=[io.Image, io.Video]', new_content)
    # Add **kwargs to execute if missing, but only if no ** exists
    new_content = re.sub(r'def execute\(cls, ([^)]+)\):', lambda m: f'def execute(cls, {m.group(1)}):' if '**' in m.group(1) else f'def execute(cls, {m.group(1)}, **kwargs):', new_content)
    
    filepath.write_text(new_content, "utf-8")
    print(f"Migrated {filepath.name} to V3")


def run():
    nodes_dir = BASE_DIR / "nodes"
    for py_file in nodes_dir.glob("*.py"):
        if py_file.name.startswith("_") or py_file.name == "comp.py":
            continue
        process_file(py_file)


if __name__ == "__main__":
    run()
