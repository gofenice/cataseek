fpath = 'plugins/prestashop/cataseek/cataseek.php'

with open(fpath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the line containing the comment about design notice
target_comment = 'Design settings info notice'
start_idx = None
for i, line in enumerate(lines):
    if target_comment in line:
        start_idx = i
        break

if start_idx is None:
    print("ERROR: Could not find target comment line")
    exit(1)

# Find the end of that array block (closes with '),')
end_idx = None
for i in range(start_idx, min(start_idx + 20, len(lines))):
    stripped = lines[i].strip()
    if stripped == '),' and i > start_idx:
        end_idx = i
        break

if end_idx is None:
    print("ERROR: Could not find end of array block")
    exit(1)

print(f"Found block: lines {start_idx+1} to {end_idx+1}")

# New block: info notice + GET link refresh button (no nested form)
new_block = (
    "                    // Design settings info notice + refresh GET link (no nested form)\n"
    "                    array(\n"
    "                        'type'         => 'html',\n"
    "                        'name'         => 'cataseek_design_notice',\n"
    "                        'html_content' =>\n"
    "                            '<div style=\"margin:20px 0;padding:14px 18px;background:#f0f4ff;border-left:4px solid #4F46E5;border-radius:4px;\">'\n"
    "                            . '<strong>&#127912; ' . $this->l('Design Settings') . '</strong><br>'\n"
    "                            . $this->l('Colors, icon type, modal size and position are managed in your') . ' '\n"
    "                            . '<strong><a href=\"https://phpstack-1469939-5553288.cloudwaysapps.com/settings\" target=\"_blank\">Cataseek Dashboard &rarr; Settings</a></strong>.<br><br>'\n"
    "                            . '<a href=\"' . $this->context->link->getAdminLink('AdminModules', true) . '&configure=' . $this->name . '&tab_module=' . $this->tab . '&module_name=' . $this->name . '&submitCataseekRefreshSettings=1\" style=\"display:inline-block;background:#4F46E5;color:#fff;padding:8px 18px;border-radius:4px;text-decoration:none;font-size:13px;\">&#128260; ' . $this->l('Refresh Settings from Dashboard') . '</a>'\n"
    "                            . '</div>',\n"
    "                    ),\n"
)

lines[start_idx:end_idx+1] = [new_block]

with open(fpath, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("SUCCESS: Block replaced")
