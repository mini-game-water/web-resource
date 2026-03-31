# deploy-terraform.ps1
# Terraform plan → apply → PEM 키 자동 추출 스크립트

$ErrorActionPreference = "Stop"
$TerraformDir = $PSScriptRoot
$PemPath = "C:\Users\ab550\OneDrive\Desktop\aws_keys\gamehub-ec2-key.pem"

Write-Host "`n===== Terraform Plan =====" -ForegroundColor Cyan
Set-Location $TerraformDir
terraform plan -out tfplan
if ($LASTEXITCODE -ne 0) {
    Write-Host "terraform plan 실패" -ForegroundColor Red
    exit 1
}

Write-Host "`n===== Terraform Apply =====" -ForegroundColor Cyan
terraform apply tfplan
if ($LASTEXITCODE -ne 0) {
    Write-Host "terraform apply 실패" -ForegroundColor Red
    exit 1
}

Write-Host "`n===== Private Key 추출 =====" -ForegroundColor Cyan
$key = terraform output -raw private_key_pem
if ($LASTEXITCODE -ne 0) {
    Write-Host "private_key_pem 출력 실패" -ForegroundColor Red
    exit 1
}

$key | Out-File -FilePath $PemPath -Encoding ascii -NoNewline
Write-Host "PEM 키 저장 완료: $PemPath" -ForegroundColor Green

Write-Host "`n===== 배포 완료 =====" -ForegroundColor Green
terraform output app_url
terraform output ec2_public_ip
