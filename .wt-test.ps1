$out = 'F:\ai\myt_tools\.wt-pty-result.txt'
"=== WT 环境测试 ===" | Out-File -FilePath $out -Encoding utf8
"whoami: $(whoami)" | Out-File -FilePath $out -Append -Encoding utf8
"PWD: $PWD" | Out-File -FilePath $out -Append -Encoding utf8
"node: $(node --version 2>&1)" | Out-File -FilePath $out -Append -Encoding utf8
"bash.path: $((Get-Command bash -ErrorAction SilentlyContinue).Source)" | Out-File -FilePath $out -Append -Encoding utf8
"uname-via-bash: $(bash -c 'uname -s' 2>&1)" | Out-File -FilePath $out -Append -Encoding utf8
