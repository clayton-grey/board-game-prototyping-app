# <ai_context>
# This file provides a Python script to parse and apply XML-based file modifications.
# Updated to read patch.xml from the current directory instead of stdin.
# </ai_context>

"""
Applys the patches defined by the prompt_format.txt format.
"""

import os
import sys
import xml.etree.ElementTree as ET

def find_ai_context_block(content: str) -> tuple:
    """
    Return the start and end indices of the <ai_context> block if present, otherwise (-1, -1).
    """
    start_marker = "# <ai_context>"
    end_marker = "# </ai_context>"

    lines = content.splitlines()
    start_index = -1
    end_index = -1

    for i, line in enumerate(lines):
        if start_marker in line:
            start_index = i
        if end_marker in line:
            end_index = i
            break

    return start_index, end_index

def merge_ai_context(old_content: str, new_content: str) -> str:
    """
    Merge or preserve <ai_context> block from old_content into new_content
    following the formatting rules:
      - If new_content does not have <ai_context> but old_content does, prepend old_content's block.
      - If new_content has <ai_context>, keep it as is (do not remove).
    """
    old_start, old_end = find_ai_context_block(old_content)
    new_start, new_end = find_ai_context_block(new_content)

    # Case 1: New content has no ai_context, old has ai_context
    if old_start != -1 and new_start == -1:
        # Extract old ai_context
        old_lines = old_content.splitlines()
        ai_context_block = old_lines[old_start:old_end+1]
        # Prepend to new content
        return "\n".join(ai_context_block) + "\n" + new_content

    # Case 2: Otherwise, just return new_content
    return new_content

def process_create(file_path: str, file_code: str):
    """
    Create a new file with the provided file_code.
    If there is no <ai_context> block, one is added at the top.
    """
    start, end = find_ai_context_block(file_code)
    if start == -1 or end == -1:
        # Prepend minimal <ai_context> if not found
        ai_context_lines = [
            "# <ai_context>",
            "# This file was created automatically by the Python XML parser script.",
            "# </ai_context>",
            ""
        ]
        file_code = "\n".join(ai_context_lines) + file_code

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(file_code)

def process_update(file_path: str, file_code: str):
    """
    Update an existing file. Preserve the old file's <ai_context> if the new file doesn't have one.
    """
    if not os.path.exists(file_path):
        # If the file doesn't exist, treat it like a create.
        process_create(file_path, file_code)
        return

    with open(file_path, "r", encoding="utf-8") as f:
        old_content = f.read()

    merged_content = merge_ai_context(old_content, file_code)

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(merged_content)

def process_delete(file_path: str):
    """
    Delete the specified file if it exists.
    """
    if os.path.exists(file_path):
        os.remove(file_path)

def main(xml_input: str):
    """
    Main entry point:
    1) Parse the XML from patch.xml.
    2) For each <file> entry, apply the specified operation.
    """
    tree = ET.ElementTree(ET.fromstring(xml_input))
    root = tree.getroot()

    changed_files = root.find("changed_files")
    if changed_files is None:
        print("No <changed_files> element found in the XML.")
        return

    for file_element in changed_files.findall("file"):
        operation_element = file_element.find("file_operation")
        path_element = file_element.find("file_path")
        code_element = file_element.find("file_code")

        if operation_element is None or path_element is None:
            print("Missing <file_operation> or <file_path> in XML. Skipping this entry.")
            continue

        operation = operation_element.text.strip()
        file_path = path_element.text.strip()
        file_code = code_element.text if code_element is not None else ""

        if operation.upper() == "CREATE":
            process_create(file_path, file_code)
        elif operation.upper() == "UPDATE":
            process_update(file_path, file_code)
        elif operation.upper() == "DELETE":
            process_delete(file_path)
        else:
            print(f"Unknown operation: {operation}. Skipping.")

if __name__ == "__main__":
    if not os.path.exists("patch.xml"):
        print("patch.xml not found in the current directory.")
        sys.exit(1)
    with open("patch.xml", "r", encoding="utf-8") as f:
        xml_input = f.read()
    main(xml_input)