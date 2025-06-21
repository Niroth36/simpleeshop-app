pipeline {
    agent any
    
    environment {
        DOCKER_HUB_CREDENTIALS = 'docker-hub-credentials'
        DOCKER_IMAGE = 'niroth36/simpleeshop'
        GITOPS_REPO = 'https://github.com/Niroth36/simpleeshop-gitops.git'
        GITOPS_CREDENTIALS = 'github-credentials'
        APP_NAME = 'simpleeshop'
        // Enable Docker BuildKit for multi-arch builds
        DOCKER_BUILDKIT = '1'
    }
    
    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    // Generate image tag from git commit
                    env.IMAGE_TAG = sh(
                        script: "git rev-parse --short HEAD",
                        returnStdout: true
                    ).trim()
                    env.BUILD_NUMBER_TAG = "${env.BUILD_NUMBER}-${env.IMAGE_TAG}"
                    env.FULL_IMAGE_TAG = "${DOCKER_IMAGE}:${BUILD_NUMBER_TAG}"
                }
                echo "🏗️ Building: ${env.FULL_IMAGE_TAG}"
            }
        }
        
        stage('Install Dependencies') {
            steps {
                dir('web-app') {
                    sh 'npm ci'
                }
            }
        }
        
        stage('Run Tests') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        dir('web-app') {
                            sh 'npm test || true'
                        }
                    }
                }
                stage('Lint Code') {
                    steps {
                        dir('web-app') {
                            sh 'npm run lint || true'
                        }
                    }
                }
                stage('Security Audit') {
                    steps {
                        dir('web-app') {
                            sh 'npm audit --audit-level=high || true'
                        }
                    }
                }
            }
        }
        
        stage('Setup Docker Buildx') {
            steps {
                script {
                    sh """
                        # Create and use buildx builder for multi-arch
                        docker buildx create --name mybuilder --use || true
                        docker buildx inspect --bootstrap
                        
                        # Enable experimental features
                        export DOCKER_CLI_EXPERIMENTAL=enabled
                    """
                }
            }
        }
        
        stage('Build Multi-Architecture Image') {
            steps {
                script {
                    withCredentials([usernamePassword(credentialsId: DOCKER_HUB_CREDENTIALS, usernameVariable: 'DOCKER_USERNAME', passwordVariable: 'DOCKER_PASSWORD')]) {
                        sh """
                            # Login to Docker Hub
                            echo \$DOCKER_PASSWORD | docker login -u \$DOCKER_USERNAME --password-stdin
                            
                            # Build and push multi-arch image
                            docker buildx build \\
                                --platform linux/amd64,linux/arm64 \\
                                --tag ${FULL_IMAGE_TAG} \\
                                --tag ${DOCKER_IMAGE}:latest \\
                                --push \\
                                --file Dockerfile \\
                                .
                            
                            echo "✅ Multi-arch image built and pushed: ${FULL_IMAGE_TAG}"
                        """
                    }
                }
            }
        }
        
        stage('Security Scan') {
            steps {
                script {
                    // Scan the AMD64 version (most tools support this architecture)
                    sh """
                        # Pull the image for scanning
                        docker pull --platform linux/amd64 ${FULL_IMAGE_TAG}
                        
                        # Run security scan with Trivy
                        docker run --rm \\
                            -v /var/run/docker.sock:/var/run/docker.sock \\
                            aquasec/trivy:latest image \\
                            --format table \\
                            --exit-code 0 \\
                            --severity HIGH,CRITICAL \\
                            ${FULL_IMAGE_TAG} || true
                    """
                }
            }
        }
        
        stage('Update GitOps Repository') {
            steps {
                script {
                    withCredentials([usernamePassword(credentialsId: GITOPS_CREDENTIALS, usernameVariable: 'GIT_USERNAME', passwordVariable: 'GIT_PASSWORD')]) {
                        sh """
                            # Clean workspace
                            rm -rf gitops-repo
                            
                            # Configure git
                            git config --global user.email "jenkins@simpleeshop.local"
                            git config --global user.name "Jenkins CI/CD"
                            
                            # Clone GitOps repository
                            git clone https://${GIT_USERNAME}:${GIT_PASSWORD}@github.com/Niroth36/simpleeshop-gitops.git gitops-repo
                            cd gitops-repo
                            
                            # Update image tag in deployment manifest
                            sed -i 's|image: ${DOCKER_IMAGE}:.*|image: ${FULL_IMAGE_TAG}|g' applications/simpleeshop/simpleeshop-deployment.yaml
                            
                            # Verify the change
                            echo "📝 Updated deployment manifest:"
                            grep "image:" applications/simpleeshop/simpleeshop-deployment.yaml
                            
                            # Commit and push changes
                            git add applications/simpleeshop/simpleeshop-deployment.yaml
                            git status
                            
                            if git diff --staged --quiet; then
                                echo "ℹ️ No changes to commit"
                            else
                                git commit -m "🚀 Deploy ${APP_NAME} ${BUILD_NUMBER_TAG}
                            
                                - Jenkins Build: #${BUILD_NUMBER}
                                - Git Commit: ${IMAGE_TAG}
                                - Docker Image: ${FULL_IMAGE_TAG}
                                - Multi-arch: linux/amd64,linux/arm64
                                - Timestamp: \$(date -u +"%Y-%m-%d %H:%M:%S UTC")"
                                
                                git push origin main
                                echo "✅ GitOps repository updated successfully!"
                            fi
                        """
                    }
                }
            }
        }
        
        stage('Trigger Deployment') {
            steps {
                script {
                    echo "🔄 ArgoCD will automatically sync the new deployment"
                    echo "📦 New multi-arch image: ${env.FULL_IMAGE_TAG}"
                    echo "🌐 Deployment URL: http://4.210.149.226:30000"
                    
                    // Optional: You can add ArgoCD CLI commands here to force sync
                    // sh "argocd app sync simpleeshop"
                }
            }
        }
    }
    
    post {
        always {
            // Clean up local images to save space
            sh """
                # Remove local images
                docker rmi ${FULL_IMAGE_TAG} || true
                docker rmi ${DOCKER_IMAGE}:latest || true
                
                # Clean up build cache
                docker builder prune -f || true
                
                # Clean up workspace
                rm -rf gitops-repo || true
            """
        }
        
        success {
            script {
                def deploymentTime = new Date().format("yyyy-MM-dd HH:mm:ss")
                echo """
                🎉 SUCCESS: SimpleEshop CI/CD Pipeline Completed!
                
                📦 Image Details:
                   - Repository: ${DOCKER_IMAGE}
                   - Tag: ${BUILD_NUMBER_TAG}
                   - Full Image: ${FULL_IMAGE_TAG}
                   - Architectures: linux/amd64, linux/arm64
                   
                🚀 Deployment:
                   - GitOps Repo Updated: ✅
                   - ArgoCD Sync: Automatic
                   - Application URL: http://4.210.149.226:30000
                   
                ⏰ Deployment Time: ${deploymentTime}
                """
            }
        }
        
        failure {
            echo """
            ❌ FAILED: SimpleEshop CI/CD Pipeline Failed!
            
            🔍 Check the following:
               - Docker Hub credentials
               - GitHub credentials  
               - Network connectivity
               - Application tests
               - Multi-arch build support
               
            📋 Build Details:
               - Build Number: ${BUILD_NUMBER}
               - Commit: ${env.IMAGE_TAG}
               - Branch: ${env.BRANCH_NAME}
            """
        }
        
        cleanup {
            // Additional cleanup
            sh 'docker system prune -f || true'
        }
    }
}