# Create directories
sudo mkdir -p /var/lib/firecracker

# Download a kernel
sudo curl -fsSL -o /var/lib/firecracker/vmlinux \
  https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/x86_64/kernels/vmlinux.bin

# Download a rootfs
sudo curl -fsSL -o /var/lib/firecracker/rootfs.ext4 \
  https://s3.amazonaws.com/spec.ccfc.min/img/quickstart_guide/x86_64/rootfs/bionic.rootfs.ext4

# Set permissions
sudo chmod +r /var/lib/firecracker/vmlinux
sudo chmod +r /var/lib/firecracker/rootfs.ext4
